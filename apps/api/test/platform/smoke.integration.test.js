// @ts-check
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSmoke } from '../../../../scripts/smoke.js';
import { createPlatform, startRole } from '../../src/platform/boot.js';
import { loadConfig } from '../../src/platform/config.js';
import { createLogger } from '../../src/platform/logger.js';
import { eventually, HOOK_TIMEOUT_MS, makeKeys, startInfra, testEnv } from './helpers.js';
import modules from '../../src/modules/index.js';

/** @returns {Promise<number>} */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === 'object'
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });

describe('production smoke suite against a running API (Phase 15)', () => {
  /** @type {import('./helpers.js').Infra} */
  let infra;
  /** @type {Awaited<ReturnType<typeof startRole>>} */
  let runtime;
  let api = '';

  beforeAll(async () => {
    infra = await startInfra();
    const keys = await makeKeys();
    const [port, metricsPort] = await Promise.all([freePort(), freePort()]);
    const config = loadConfig(
      testEnv({
        ROLE: 'api',
        HOST: '127.0.0.1',
        PORT: String(port),
        METRICS_PORT: String(metricsPort),
        DATABASE_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
        CORS_ORIGINS: 'https://app.example.test',
        METRICS_SCRAPE_TOKEN: 'm'.repeat(40),
      }),
    );
    const platform = await createPlatform({ config, logger: createLogger({ level: 'silent' }) });
    runtime = await startRole({ platform, modules });
    api = `http://127.0.0.1:${port}`;
    await eventually(async () => (await fetch(`${api}/ready`)).status === 200, 30_000);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await runtime?.stop(10_000);
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('every check passes, and the CORS check accepts the configured web origin', async () => {
    const results = await runSmoke({ api });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
    // The web-origin checks: CORS passes; the page check fails here (no web app is served).
    const withWeb = await runSmoke({ api, web: 'https://app.example.test' });
    const cors = withWeb.find((r) => r.name === 'CORS allows the web app with credentials');
    expect(cors?.ok).toBe(true);
  });

  it('a broken dependency fails the suite', async () => {
    const results = await runSmoke({
      api,
      fetch: async (input, init) =>
        String(input).endsWith('/ready')
          ? new Response('{"status":"not_ready"}', { status: 503 })
          : fetch(input, init),
    });
    expect(results.find((r) => r.name.startsWith('GET /ready'))?.ok).toBe(false);
  });
});
