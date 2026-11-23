// @ts-check
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlatform, startRole } from '../../src/platform/boot.js';
import { loadConfig } from '../../src/platform/config.js';
import { createLogger } from '../../src/platform/logger.js';
import { eventually, HOOK_TIMEOUT_MS, makeKeys, startInfra, testEnv } from './helpers.js';

const MAIN = fileURLToPath(new URL('../../src/main.js', import.meta.url));

/** @returns {Promise<number>} A free TCP port. */
function freePort() {
  return new Promise((resolve, reject) => {
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
}

/** A logger whose lines are captured as parsed JSON. */
function capturingLogger() {
  /** @type {any[]} */
  const lines = [];
  const destination = new Writable({
    write(chunk, _enc, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      done();
    },
  });
  return { lines, logger: createLogger({ level: 'info', destination }) };
}

describe('boot', () => {
  /** @type {import('./helpers.js').Infra} */
  let infra;
  /** @type {Record<string, string>} */
  let env;

  beforeAll(async () => {
    infra = await startInfra();
    const keys = await makeKeys();
    env = testEnv({
      DATABASE_URL: infra.appUrl,
      REDIS_URL: infra.redisUrl,
      JWT_SIGNING_KEYS: keys.json,
      JWT_ACTIVE_KID: keys.kid,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  /** @param {Record<string, string>} overrides @param {import('pino').Logger} [logger] */
  async function start(overrides, logger = createLogger({ level: 'silent' })) {
    const config = loadConfig({ ...env, ...overrides });
    const platform = await createPlatform({ config, logger });
    return startRole({ platform, modules: [], listen: false });
  }

  describe.each(['api', 'ws', 'worker', 'all'])('ROLE=%s (in process)', (role) => {
    it('serves /health and /ready, exposes /metrics only on the metrics server, and stops', async () => {
      const runtime = await start({ ROLE: role });
      expect((await runtime.http.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
      const ready = await eventually(async () => {
        const response = await runtime.http.inject({ url: '/ready' });
        return response.statusCode === 200 ? response.json() : null;
      });
      expect(ready).toEqual({
        status: 'ready',
        checks: { postgres: 'ok', redis: 'ok', migrations: 'ok' },
      });
      expect((await runtime.http.inject({ url: '/metrics' })).statusCode).toBe(404);
      const metrics = await runtime.metricsServer.inject({ url: '/metrics' });
      expect(metrics.body).toContain('process_cpu_user_seconds_total');
      expect(metrics.body).toContain('nodejs_eventloop_lag_seconds');
      const docs = await runtime.http.inject({ url: '/docs/json' });
      expect(docs.statusCode).toBe(role === 'api' || role === 'all' ? 200 : 404);
      await runtime.stop(5_000);
    }, 30_000);
  });

  it('serves /internal/metrics on the public port only for the scrape token, with the ops gauges (Phase 15)', async () => {
    const token = 's'.repeat(40);
    // ROLE=api: no relay or workers, so the seeded rows and jobs stay put.
    const runtime = await start({ ROLE: 'api', METRICS_SCRAPE_TOKEN: token });
    try {
      // An unpublished event 2 minutes old, a dead-lettered job, a waiting job and a backup.
      await infra.admin`INSERT INTO platform.outbox (name, version, payload, created_at)
        VALUES ('thing.happened.v1', 1, '{}', now() - interval '2 minutes')`;
      await infra.admin`INSERT INTO platform.backup_runs (environment, object_key, bytes, taken_at)
        VALUES ('staging', 'backups/staging/x.dump', 10, now() - interval '3 hours')`;
      await runtime.platform.jobs.deadLetterQueue('fast').add('x', {});
      await runtime.platform.jobs.queue('external').pause();
      await runtime.platform.jobs
        .queue('external')
        .add('y', {}, { timestamp: Date.now() - 90_000 });

      for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: token }]) {
        const refused = await runtime.http.inject({ url: '/internal/metrics', headers });
        expect(refused.statusCode).toBe(404);
        expect(refused.body).not.toContain('vouch_');
      }
      const scrape = await runtime.http.inject({
        url: '/internal/metrics',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(scrape.statusCode).toBe(200);
      expect(scrape.headers['cache-control']).toBe('no-store');
      const value = (/** @type {string} */ line) => {
        const found = scrape.body.split('\n').find((l) => l.startsWith(`${line} `));
        return found ? Number(found.slice(line.length + 1)) : Number.NaN;
      };
      expect(value('vouch_outbox_lag_seconds')).toBeGreaterThanOrEqual(115);
      expect(value('vouch_outbox_unpublished')).toBeGreaterThanOrEqual(1);
      expect(value('vouch_backup_age_seconds')).toBeGreaterThanOrEqual(3 * 3600 - 5);
      expect(value('vouch_dead_letter_jobs{queue="fast"}')).toBe(1);
      expect(value('vouch_dead_letter_jobs{queue="bulk"}')).toBe(0);
      expect(value('vouch_queue_oldest_waiting_seconds{queue="external"}')).toBeGreaterThanOrEqual(
        85,
      );
      expect(value('vouch_queue_oldest_waiting_seconds{queue="fast"}')).toBe(0);
      expect(scrape.body).toContain('process_cpu_user_seconds_total');
      // The internal port serves the same gauges.
      const internal = await runtime.metricsServer.inject({ url: '/metrics' });
      expect(internal.body).toContain('vouch_outbox_lag_seconds');
    } finally {
      await runtime.platform.jobs.queue('external').obliterate({ force: true });
      await runtime.platform.jobs.deadLetterQueue('fast').obliterate({ force: true });
      await infra.admin`UPDATE platform.outbox SET published_at = now() WHERE published_at IS NULL`;
      await infra.admin`DELETE FROM platform.backup_runs`;
      await runtime.stop(5_000);
    }
  }, 30_000);

  it('/internal/metrics does not exist without a scrape token', async () => {
    const runtime = await start({ ROLE: 'api' });
    const response = await runtime.http.inject({
      url: '/internal/metrics',
      headers: { authorization: 'Bearer anything' },
    });
    expect(response.statusCode).toBe(404);
    await runtime.stop(5_000);
  });

  it('/ready reflects a stopped Redis, logs only the change, and recovers', async () => {
    const { lines, logger } = capturingLogger();
    const runtime = await start({ ROLE: 'api' }, logger);
    for (let i = 0; i < 5; i += 1) {
      await runtime.http.inject({ url: '/health' });
      await runtime.http.inject({ url: '/ready' });
    }
    expect(lines.filter((l) => /\/(health|ready)/.test(JSON.stringify(l)))).toEqual([]);
    expect(
      lines.filter((l) => l.msg === 'incoming request' || l.msg === 'request completed'),
    ).toEqual([]);

    infra.redisControl('pause');
    try {
      for (let i = 0; i < 3; i += 1) {
        const response = await runtime.http.inject({ url: '/ready' });
        expect(response.statusCode).toBe(503);
        expect(response.json().checks).toMatchObject({
          postgres: 'ok',
          redis: 'fail',
          migrations: 'ok',
        });
      }
    } finally {
      infra.redisControl('unpause');
    }
    await eventually(async () => (await runtime.http.inject({ url: '/ready' })).statusCode === 200);
    expect(lines.filter((l) => l.msg === 'not ready')).toHaveLength(1);
    expect(lines.filter((l) => l.msg === 'ready again')).toHaveLength(1);
    await runtime.stop(5_000);
  }, 60_000);

  it('the worker role runs the nightly retention tick, purging old event bookkeeping', async () => {
    const runtime = await start({ ROLE: 'worker' });
    const [row] = await infra.admin`
      INSERT INTO platform.outbox (name, version, payload, published_at)
      VALUES ('user.deleted.v1', 1, '{}', now() - interval '8 days') RETURNING id`;
    await runtime.platform.jobs.queue('bulk').add('platform.retentionTick', {});
    await eventually(
      async () =>
        (await infra.admin`SELECT 1 FROM platform.outbox WHERE id = ${row.id}`).length === 0,
      20_000,
    );
    // Tasks owned by later phases are acknowledged and skipped by the platform handler.
    const ignored = await runtime.platform.jobs.add('platform.retention', {
      task: 'messages',
      olderThan: new Date().toISOString(),
    });
    // finishedOn and returnvalue are written together when the job completes.
    const done = await eventually(async () => {
      const job = await runtime.platform.jobs.queue('bulk').getJob(String(ignored.id));
      return job?.finishedOn ? job : null;
    }, 20_000);
    expect(done?.returnvalue).toEqual({ skipped: 'messages' });
    await runtime.stop(10_000);
  }, 60_000);

  it('/ready reports pending migrations', async () => {
    const config = loadConfig({ ...env, ROLE: 'api' });
    const platform = await createPlatform({ config, logger: createLogger({ level: 'silent' }) });
    const runtime = await startRole({
      platform,
      modules: [],
      listen: false,
      expectedMigrations: ['29991231000000_not_applied'],
    });
    const response = await runtime.http.inject({ url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.migrations).toBe('fail');
    await runtime.stop(5_000);
  });

  it('rejects requests from app versions below the minimum', async () => {
    const runtime = await start({ ROLE: 'api', APP_MIN_SUPPORTED_VERSION: '2.0.0' });
    const old = await runtime.http.inject({ url: '/nope', headers: { 'x-app-version': '1.9.0' } });
    expect(old.json().error.code).toBe('APP_VERSION_UNSUPPORTED');
    const current = await runtime.http.inject({
      url: '/nope',
      headers: { 'x-app-version': '2.0.0' },
    });
    expect(current.json().error.code).toBe('NOT_FOUND');
    await runtime.stop(5_000);
  });

  describe('main.js as a real process', () => {
    /**
     * @param {Record<string, string>} extra
     */
    async function spawnMain(extra) {
      const metricsPort = await freePort();
      const child = spawn(process.execPath, [MAIN], {
        env: {
          PATH: process.env.PATH ?? '',
          ...env,
          LOG_LEVEL: 'info',
          PORT: '0',
          HOST: '127.0.0.1',
          METRICS_PORT: String(metricsPort),
          ...extra,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      /** @type {Promise<number | null>} */
      const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
      return { child, exited, metricsPort, output: () => output };
    }

    it.each(['api', 'ws', 'worker', 'all'])(
      'ROLE=%s boots, answers, and drains on SIGTERM with exit 0',
      async (role) => {
        const proc = await spawnMain({ ROLE: role, SHUTDOWN_DRAIN_MS: '5000' });
        try {
          const url = await eventually(
            () => /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(proc.output())?.[1],
            15_000,
          );
          expect(
            await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })).json(),
          ).toEqual({ status: 'ok' });
          await eventually(
            async () =>
              (await fetch(`${url}/ready`, { signal: AbortSignal.timeout(5000) })).status === 200,
          );
          const metrics = await fetch(`http://127.0.0.1:${proc.metricsPort}/metrics`, {
            signal: AbortSignal.timeout(5000),
          });
          expect(await metrics.text()).toContain('http_request_duration_seconds');
          expect(proc.output()).toContain(`"role":"${role}"`);
        } finally {
          proc.child.kill('SIGTERM');
        }
        expect(await proc.exited).toBe(0);
        expect(proc.output()).toContain('"drainMs":5000');
        expect(proc.output()).toContain('shutdown complete');
      },
      60_000,
    );

    it('refuses to boot with an invalid environment, without printing secrets', async () => {
      const proc = await spawnMain({ EMAIL_HMAC_SECRET: 'short-secret-value', ROLE: 'api' });
      expect(await proc.exited).toBe(1);
      expect(proc.output()).toContain('refusing to boot');
      expect(proc.output()).toContain('EMAIL_HMAC_SECRET');
      expect(proc.output()).not.toContain('short-secret-value');
    }, 30_000);

    it('refuses to boot with an invalid PORT (Phase 1 check, kept)', async () => {
      const proc = await spawnMain({ PORT: 'not-a-port', ROLE: 'api' });
      expect(await proc.exited).toBe(1);
      expect(proc.output()).toContain('PORT');
    }, 30_000);
  });
});
