// @ts-check
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALERTS, alertRuleGroup, allDashboards } from '../../../../infra/grafana/build.js';
import { createGrafanaSync } from '../../../../infra/grafana/sync.js';
import { createMetrics, createOpsGauges } from '../../src/platform/metrics.js';

const GRAFANA = new URL('../../../../infra/grafana/', import.meta.url);
/** Gauges set by modules (not the ops collector), and where. */
const MODULE_GAUGES = new Map([
  ['vouch_consistency_violations', '../../src/platform/jobs/consistency.js'],
  ['vouch_photo_reviews_overdue', '../../src/modules/media/application/review.js'],
]);

/** Every metric name the API exports, with histogram and counter series expanded. */
async function exportedMetrics() {
  const metrics = createMetrics();
  const ops = createOpsGauges({
    metrics,
    db: /** @type {any} */ ({ read: async () => [[{ lag: 1, unpublished: 1 }], [{ age: 1 }]] }),
    jobs: /** @type {any} */ ({
      queue: () => ({ getJobs: async () => [] }),
      deadLetterQueue: () => ({ getJobCounts: async () => ({ waiting: 0 }) }),
    }),
    queueNames: ['fast'],
    logger: /** @type {any} */ ({ warn: () => {} }),
    redis: { info: async () => 'used_memory:1\r\nmaxmemory:2\r\n' },
  });
  await ops.collect();
  metrics.observeHttp({ method: 'GET', route: '/x', statusCode: 500, seconds: 0.1 });
  metrics.observeUseCase('identity.x', 'ok', 0.1);
  metrics.countShed('http', 'in_flight');
  const names = new Set();
  for (const metric of await metrics.registry.getMetricsAsJSON()) {
    for (const value of metric.values)
      names.add(/** @type {any} */ (value).metricName ?? metric.name);
    names.add(metric.name);
  }
  for (const [name, file] of MODULE_GAUGES) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed source files
    expect(await readFile(new URL(file, import.meta.url), 'utf8')).toContain(`'${name}'`);
    names.add(name);
  }
  return names;
}

/** @param {string} expr */
const metricsIn = (expr) =>
  [...expr.matchAll(/\b((?:vouch|http|usecase|process|nodejs)_[a-z0-9_]+)\b/g)].map((m) => m[1]);

describe('Grafana as code (Phase 15)', () => {
  it('the committed JSON matches build.js (run node infra/grafana/build.js)', async () => {
    for (const [name, model] of allDashboards()) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed names
      const file = JSON.parse(await readFile(new URL(`dashboards/${name}`, GRAFANA), 'utf8'));
      expect(file, name).toEqual(JSON.parse(JSON.stringify(model)));
    }
  });

  it('every dashboard query and alert uses only metrics the API exports', async () => {
    const exported = await exportedMetrics();
    const exprs = [
      ...[...allDashboards().values()].flatMap((d) =>
        d.panels.flatMap((p) => p.targets.map((t) => t.expr)),
      ),
      ...ALERTS.map((a) => a.expr),
    ];
    const unknown = new Set(exprs.flatMap(metricsIn).filter((name) => !exported.has(name)));
    expect([...unknown]).toEqual([]);
    expect(exprs.length).toBeGreaterThan(60);
  });

  it('alerts cover the launch list, on production only, routed to the contact point', () => {
    const group = alertRuleGroup({
      datasourceUid: 'prom',
      folderUid: 'vouch',
      contactPoint: 'Owner',
    });
    const titles = group.rules.map((r) => r.title).join(' | ');
    for (const needed of [
      '5xx above 2%',
      'Outbox lag',
      'Dead-letter',
      'Redis memory above 70%',
      'Backup older than 26 hours',
      'Overload sheds',
    ]) {
      expect(titles).toContain(needed);
    }
    for (const rule of group.rules) {
      expect(rule.data[0]?.model.expr).toContain('job="vouch-production"');
      expect(rule.notification_settings.receiver).toBe('Owner');
    }
  });

  it('sync uploads the folder, every dashboard and the rule group, with the token in a header only', async () => {
    /** @type {{ method: string, url: string, body: any, auth: string }[]} */
    const calls = [];
    /** @type {typeof fetch} */
    const fakeFetch = async (input, init = {}) => {
      const headers = /** @type {Record<string, string>} */ (init.headers ?? {});
      calls.push({
        method: init.method ?? 'GET',
        url: String(input),
        body: init.body ? JSON.parse(String(init.body)) : null,
        auth: headers.authorization,
      });
      if (String(input).endsWith('/api/folders/vouch')) return new Response('{}', { status: 404 });
      return new Response('{}', { status: 200 });
    };
    const sync = createGrafanaSync({
      url: 'https://stack.grafana.net/',
      token: 'glsa_x',
      datasourceUid: 'prom',
      contactPoint: 'Owner',
      fetch: fakeFetch,
    });
    await sync.syncAll();
    expect(calls.filter((c) => c.url.endsWith('/api/dashboards/db'))).toHaveLength(10);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/folders'))).toBe(true);
    const rules = calls.find((c) => c.method === 'PUT');
    expect(rules?.url).toBe(
      'https://stack.grafana.net/api/v1/provisioning/folder/vouch/rule-groups/vouch-production',
    );
    expect(rules?.body.rules[0].data[0].datasourceUid).toBe('prom');
    expect(calls.every((c) => c.auth === 'Bearer glsa_x' && !c.url.includes('glsa_x'))).toBe(true);
  });
});
