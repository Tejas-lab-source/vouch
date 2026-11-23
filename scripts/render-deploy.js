// @ts-check
/**
 * Deploys one exact commit to a Render service and waits for it, or rolls back (Phase 15).
 * Used by .github/workflows/deploy.yml, with RENDER_API_KEY from the GitHub environment.
 *
 *   node scripts/render-deploy.js current  --service srv-…            # prints the live deploy id
 *   node scripts/render-deploy.js deploy   --service srv-… --commit <sha>
 *   node scripts/render-deploy.js rollback --service srv-… --to dep-…
 *
 * Render's REST API (https://api.render.com/v1). The endpoint shapes are checked against the
 * real API at the first staging deploy (docs/infrastructure.md): list items may come wrapped
 * as `{ deploy, cursor }` or bare, and both are accepted.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const RENDER_API = 'https://api.render.com/v1';
const DONE = new Set(['live']);
const FAILED = new Set([
  'build_failed',
  'update_failed',
  'pre_deploy_failed',
  'canceled',
  'deactivated',
]);

/**
 * @param {{ apiKey: string, fetch?: typeof fetch, base?: string, sleep?: (ms: number) => Promise<void>, log?: (line: string) => void }} options
 */
export function createRenderClient({
  apiKey,
  fetch: fetchImpl = fetch,
  base = RENDER_API,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
}) {
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      // Never echo the request (it carries the key); the status and Render's message only.
      throw new Error(
        `Render ${method} ${path.split('?')[0]}: ${response.status} ${text.slice(0, 200)}`,
      );
    }
    return text ? JSON.parse(text) : null;
  };
  /** @param {any} item */
  const unwrap = (item) =>
    item && typeof item === 'object' && 'deploy' in item ? item.deploy : item;

  /**
   * @param {string} service @param {string} deployId @param {number} timeoutMs
   * @returns {Promise<any>} the live deploy
   */
  const waitLive = async (service, deployId, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    for (;;) {
      const deploy = unwrap(await call('GET', `/services/${service}/deploys/${deployId}`));
      if (deploy.status !== last) log(`deploy ${deployId}: ${deploy.status}`);
      last = deploy.status;
      if (DONE.has(deploy.status)) return deploy;
      if (FAILED.has(deploy.status)) throw new Error(`deploy ${deployId} ended ${deploy.status}`);
      if (Date.now() > deadline) throw new Error(`deploy ${deployId} still ${deploy.status}`);
      await sleep(10_000);
    }
  };

  return {
    /** The live deploy (id and commit), or null. @param {string} service */
    async current(service) {
      const list = await call('GET', `/services/${service}/deploys?limit=20`);
      const live = (Array.isArray(list) ? list : []).map(unwrap).find((d) => d?.status === 'live');
      return live ? { id: String(live.id), commit: live.commit?.id ?? null } : null;
    },
    /** @param {string} service @param {string} commit @param {number} [timeoutMs] */
    async deploy(service, commit, timeoutMs = 20 * 60_000) {
      if (!/^[0-9a-f]{40}$/.test(commit))
        throw new Error('--commit must be a full 40-character sha');
      const created = unwrap(
        await call('POST', `/services/${service}/deploys`, {
          commitId: commit,
          clearCache: 'do_not_clear',
        }),
      );
      log(`deploy ${created.id} created for ${commit.slice(0, 12)}`);
      return waitLive(service, String(created.id), timeoutMs);
    },
    /** @param {string} service @param {string} deployId @param {number} [timeoutMs] */
    async rollback(service, deployId, timeoutMs = 15 * 60_000) {
      const created = unwrap(await call('POST', `/services/${service}/rollback`, { deployId }));
      log(`rollback ${created.id} to ${deployId} created`);
      return waitLive(service, String(created.id), timeoutMs);
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { service: { type: 'string' }, commit: { type: 'string' }, to: { type: 'string' } },
  });
  const [command] = positionals;
  const apiKey = process.env.RENDER_API_KEY;
  const run = async () => {
    if (!apiKey) throw new Error('RENDER_API_KEY is not set');
    if (!values.service) throw new Error('--service is required');
    const render = createRenderClient({ apiKey, log: (line) => process.stderr.write(`${line}\n`) });
    if (command === 'current') {
      process.stdout.write(`${(await render.current(values.service))?.id ?? ''}\n`);
    } else if (command === 'deploy' && values.commit) {
      const live = await render.deploy(values.service, values.commit);
      process.stdout.write(`${live.id}\n`);
    } else if (command === 'rollback' && values.to) {
      const live = await render.rollback(values.service, values.to);
      process.stdout.write(`${live.id}\n`);
    } else {
      throw new Error(
        'usage: render-deploy.js current|deploy|rollback --service … [--commit sha] [--to dep-…]',
      );
    }
  };
  run().catch((error) => {
    process.stderr.write(
      `render-deploy failed: ${error instanceof Error ? error.message : error}\n`,
    );
    process.exitCode = 1;
  });
}
