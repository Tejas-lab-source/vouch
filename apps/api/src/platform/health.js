// @ts-check
import { z } from 'zod';

/** `GET /health` (liveness): the process is up. Operational, not part of the /v1 contracts. */
export const HealthResponse = z.strictObject({ status: z.literal('ok') });

const CheckResult = z.enum(['ok', 'fail']);

/** `GET /ready` (readiness): dependencies are reachable and the schema is current. */
export const ReadyResponse = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  checks: z.strictObject({ postgres: CheckResult, redis: CheckResult, migrations: CheckResult }),
});

const CHECK_TIMEOUT_MS = 1_000;

/**
 * Resolves to 'ok' or 'fail' within the timeout.
 * @param {() => Promise<unknown>} check
 * @returns {Promise<'ok' | 'fail'>}
 */
async function probe(check) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    await Promise.race([
      check(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Readiness checks. Logs only when readiness changes (one warn when it fails, one info when it
 * recovers), so polling load balancers do not flood the logs.
 * @param {{
 *   db: import('./db.js').Database,
 *   redis: import('ioredis').Redis,
 *   expectedMigrations: readonly string[],
 *   logger: import('pino').Logger,
 * }} deps
 */
export function createReadiness({ db, redis, expectedMigrations, logger }) {
  /** @type {'ready' | 'not_ready' | null} */
  let last = null;

  return {
    /** @returns {Promise<z.infer<typeof ReadyResponse>>} */
    async check() {
      const [postgres, redisCheck, migrations] = await Promise.all([
        probe(() => db.read('platform', (tx) => tx`SELECT 1`)),
        probe(() => redis.ping()),
        probe(async () => {
          const rows = await db.read('platform', (tx) => tx`SELECT name FROM public.pgmigrations`);
          const applied = new Set(rows.map((row) => row.name));
          const missing = expectedMigrations.filter((name) => !applied.has(name));
          if (missing.length > 0) throw new Error(`pending migrations: ${missing.join(', ')}`);
        }),
      ]);
      const checks = { postgres, redis: redisCheck, migrations };
      const status = Object.values(checks).every((c) => c === 'ok') ? 'ready' : 'not_ready';
      if (status !== last) {
        if (status === 'not_ready') logger.warn({ checks }, 'not ready');
        else if (last !== null) logger.info({ checks }, 'ready again');
        last = status;
      }
      return { status, checks };
    },
  };
}

/**
 * Registers `/health` and `/ready`. Both run at log level `silent`: no request logs.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ readiness: ReturnType<typeof createReadiness> }} deps
 */
export function registerHealthRoutes(app, { readiness }) {
  app.get(
    '/health',
    {
      logLevel: 'silent',
      config: { auth: 'public' },
      schema: { response: { 200: HealthResponse } },
    },
    async () => ({ status: /** @type {const} */ ('ok') }),
  );
  app.get(
    '/ready',
    {
      logLevel: 'silent',
      config: { auth: 'public' },
      schema: { response: { 200: ReadyResponse, 503: ReadyResponse } },
    },
    async (_request, reply) => {
      const result = await readiness.check();
      reply.code(result.status === 'ready' ? 200 : 503);
      return result;
    },
  );
}
