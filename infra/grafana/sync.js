// @ts-check
/**
 * Uploads the dashboards and alert rules to Grafana Cloud (Phase 15; checklist B10).
 *
 *   GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=<service account token> \
 *   GRAFANA_PROMETHEUS_UID=<data source uid> GRAFANA_CONTACT_POINT=<contact point name> \
 *     node infra/grafana/sync.js [--test-alert | --clear-test-alert]
 *
 * The token is read from the environment only, never from a flag or a file. `--test-alert`
 * adds an always-firing rule so you can confirm notifications reach you; `--clear-test-alert`
 * removes it.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { alertRuleGroup, allDashboards } from './build.js';

export const FOLDER = { uid: 'vouch', title: 'Vouch' };

/**
 * @param {{ url: string, token: string, datasourceUid: string, contactPoint: string, fetch?: typeof fetch, log?: (line: string) => void }} options
 */
export function createGrafanaSync({
  url,
  token,
  datasourceUid,
  contactPoint,
  fetch: fetchImpl = fetch,
  log = () => {},
}) {
  const base = url.replace(/\/+$/, '');
  /** @param {string} method @param {string} path @param {unknown} [body] @param {boolean} [allow404] */
  const call = async (method, path, body, allow404 = false) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        // Keep provisioned rules editable in the UI (they are re-synced from git anyway).
        'x-disable-provenance': 'true',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && response.status === 404) return null;
    const text = await response.text();
    if (!response.ok)
      throw new Error(`Grafana ${method} ${path}: ${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };

  const ensureFolder = async () => {
    if (!(await call('GET', `/api/folders/${FOLDER.uid}`, undefined, true))) {
      await call('POST', '/api/folders', FOLDER);
      log(`created folder ${FOLDER.title}`);
    }
  };

  return {
    async syncAll() {
      await ensureFolder();
      for (const [name, model] of allDashboards()) {
        // Panels refer to the data source through the $datasource variable.
        await call('POST', '/api/dashboards/db', {
          dashboard: { ...model, id: null },
          folderUid: FOLDER.uid,
          overwrite: true,
          message: 'infra/grafana (git)',
        });
        log(`dashboard ${name}`);
      }
      const group = alertRuleGroup({ datasourceUid, folderUid: FOLDER.uid, contactPoint });
      await call(
        'PUT',
        `/api/v1/provisioning/folder/${FOLDER.uid}/rule-groups/${group.title}`,
        group,
      );
      log(`alert rules: ${group.rules.length}`);
    },
    async testAlert() {
      await ensureFolder();
      const group = alertRuleGroup({
        datasourceUid,
        folderUid: FOLDER.uid,
        contactPoint,
        group: 'vouch-test',
        alerts: [
          {
            uid: 'vouch-test-alert',
            title: 'Test alert (remove with --clear-test-alert)',
            expr: 'vector(1)',
            op: 'gt',
            threshold: 0,
            for: '0s',
            severity: 'warning',
            summary: 'A test alert from infra/grafana/sync.js. If you received this, alerts work.',
          },
        ],
      });
      await call('PUT', `/api/v1/provisioning/folder/${FOLDER.uid}/rule-groups/vouch-test`, group);
      log('test alert added: it fires within about 2 minutes');
    },
    async clearTestAlert() {
      await call('DELETE', '/api/v1/provisioning/alert-rules/vouch-test-alert', undefined, true);
      log('test alert removed');
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { 'test-alert': { type: 'boolean' }, 'clear-test-alert': { type: 'boolean' } },
  });
  const env = new Map(Object.entries(process.env));
  const missing = [
    'GRAFANA_URL',
    'GRAFANA_TOKEN',
    'GRAFANA_PROMETHEUS_UID',
    'GRAFANA_CONTACT_POINT',
  ].filter((name) => !env.get(name));
  if (missing.length > 0) {
    process.stderr.write(`missing: ${missing.join(', ')}\n`);
    process.exitCode = 1;
  } else {
    const sync = createGrafanaSync({
      url: String(env.get('GRAFANA_URL')),
      token: String(env.get('GRAFANA_TOKEN')),
      datasourceUid: String(env.get('GRAFANA_PROMETHEUS_UID')),
      contactPoint: String(env.get('GRAFANA_CONTACT_POINT')),
      log: (line) => process.stdout.write(`${line}\n`),
    });
    const task = values['test-alert']
      ? sync.testAlert()
      : values['clear-test-alert']
        ? sync.clearTestAlert()
        : sync.syncAll();
    await task.catch((error) => {
      process.stderr.write(
        `grafana sync failed: ${error instanceof Error ? error.message : error}\n`,
      );
      process.exitCode = 1;
    });
  }
}
