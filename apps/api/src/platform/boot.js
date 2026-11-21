// @ts-check
import { EVENTS } from '@vouch/contracts';
import { listMigrationNames } from '../../migrations/run.js';
import { createTokenVerifier } from './auth.js';
import { systemClock } from './clock.js';
import { createDatabase } from './db.js';
import { createConsumer } from './events/consume.js';
import { EVENT_RETENTION, purgeEvents } from './events/retention.js';
import { createRelay, eventQueueName } from './events/relay.js';
import { createFlags } from './flags.js';
import { createReadiness } from './health.js';
import { buildHttpServer } from './http.js';
import { createIdGenerator } from './ids.js';
import { createIdempotencyStore } from './idempotency.js';
import { createJobs } from './jobs.js';
import { createMetrics, startMetricsServer } from './metrics.js';
import { createPipelines } from './pipelines.js';
import { createRedis } from './redis.js';
import { bootModules, capabilitiesOf } from './registry.js';
import { createUnitOfWork } from './uow.js';
import { createUseCaseFactory } from './use-case.js';

/** Nightly retention of event bookkeeping, 03:17 UTC (off the hour). */
const RETENTION_CRON = '17 3 * * *';

/**
 * @typedef {object} Runtime
 * @property {import('fastify').FastifyInstance} http  Public server (/health, /ready, routes).
 * @property {import('fastify').FastifyInstance} metricsServer  Internal /metrics server.
 * @property {Record<string, any>} platform  The services injected into modules.
 * @property {import('./registry.js').BootResult} boot
 * @property {(drainMs: number) => Promise<void>} stop  Graceful shutdown.
 */

/**
 * Creates every platform service from config. Nothing connects to Postgres until first use;
 * Redis connects in the background and readiness reports its state.
 * @param {{ config: import('./config.js').Config, logger: import('pino').Logger, extraDbModules?: readonly string[] }} options
 */
export async function createPlatform({ config, logger, extraDbModules = [] }) {
  const clock = systemClock;
  const db = createDatabase({
    url: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    prepare: config.DATABASE_PREPARE,
    extraModules: extraDbModules,
  });
  const redis = createRedis({ url: config.REDIS_URL });
  const metrics = createMetrics();
  const jobs = createJobs({ connection: redis.bullmq, logger });
  const flags = createFlags({ db, redis: redis.command, logger });
  const idempotency = createIdempotencyStore({ redis: redis.command });
  const pipelines = createPipelines({ logger });
  const useCase = createUseCaseFactory({ metrics, flags, idempotency });
  const verifier = await createTokenVerifier({ keys: config.jwtKeys, clock });

  return {
    config,
    logger,
    clock,
    newId: createIdGenerator({ clock }),
    db,
    redis,
    metrics,
    jobs,
    flags,
    idempotency,
    pipelines,
    useCase,
    verifier,
    /**
     * A unit of work for one module (its role, its stores).
     * @template S
     * @param {string} module
     * @param {(tx: import('postgres').TransactionSql) => S} [stores]
     */
    unitOfWork: (module, stores) => createUnitOfWork({ db, module, stores }),
  };
}

/** @typedef {Awaited<ReturnType<typeof createPlatform>>} Platform */

/**
 * Registers event consumers, module jobs, the relay and the retention schedule (worker roles).
 * @param {Platform} platform
 * @param {import('./registry.js').BootResult} boot
 * @param {Record<string, import('@vouch/contracts').EventDefinition>} events
 */
async function startWorkers(platform, boot, events) {
  const { db, jobs, logger } = platform;

  /** @type {Map<string, Record<string, (job: any) => Promise<unknown>>>} */
  const byQueue = new Map();
  const handle = (
    /** @type {string} */ queue,
    /** @type {string} */ name,
    /** @type {any} */ fn,
  ) => {
    byQueue.set(queue, { ...(byQueue.get(queue) ?? {}), [name]: fn });
  };

  for (const { module, event, handler } of boot.consumers) {
    const definition = new Map(Object.entries(events)).get(event);
    if (!definition) throw new Error(`module ${module} subscribes to unknown event ${event}`);
    handle(
      eventQueueName(module),
      event,
      createConsumer({
        db,
        consumer: module,
        event: definition,
        handler: /** @type {any} */ (handler),
      }),
    );
  }
  for (const { queue, name, handler } of boot.jobs) handle(queue, name, handler);

  handle('bulk', 'platform.retention', async (/** @type {any} */ job) => {
    const { task, olderThan } = job.data;
    if (task !== 'outbox' && task !== 'inbox') return { skipped: task };
    return { deleted: await purgeEvents(db, task, new Date(olderThan)) };
  });
  handle('bulk', 'platform.retentionTick', async () => {
    const now = platform.clock.now().getTime();
    for (const task of /** @type {const} */ (['outbox', 'inbox'])) {
      await jobs.add('platform.retention', {
        task,
        olderThan: new Date(
          now - (task === 'outbox' ? EVENT_RETENTION.outbox : EVENT_RETENTION.inbox),
        ).toISOString(),
      });
    }
  });
  await jobs.schedule('platform.retention-tick', RETENTION_CRON, 'platform.retentionTick', {});

  for (const [queue, handlers] of byQueue) jobs.process(queue, handlers);

  const relay = createRelay({ db, jobs, subscriptions: boot.subscriptions, logger });
  relay.start();
  return relay;
}

/**
 * Starts the servers and workers for one role (`api`, `ws`, `worker` or `all`).
 * - api: public HTTP with module routes.
 * - ws: public HTTP with /health and /ready only (Socket.IO arrives in Phase 9).
 * - worker: event consumers, module jobs, the outbox relay, retention; /health and /ready.
 * - all: everything in one process (beta).
 * Every role serves /metrics on METRICS_PORT.
 * @param {{
 *   platform: Platform,
 *   modules: readonly import('./registry.js').Manifest[],
 *   events?: Record<string, import('@vouch/contracts').EventDefinition>,
 *   expectedMigrations?: readonly string[],
 *   reportError?: (error: unknown) => void,
 *   listen?: boolean,
 * }} options
 * @returns {Promise<Runtime>}
 */
export async function startRole({
  platform,
  modules,
  events = EVENTS,
  expectedMigrations = listMigrationNames(),
  reportError,
  listen = true,
}) {
  const { config, logger } = platform;
  const role = config.ROLE;
  const capabilities = capabilitiesOf(role);
  const boot = await bootModules({ modules, role, platform, pipelines: platform.pipelines });

  const readiness = createReadiness({
    db: platform.db,
    redis: platform.redis.command,
    expectedMigrations,
    logger,
  });
  const http = await buildHttpServer({
    config,
    logger,
    verifier: platform.verifier,
    redis: platform.redis.command,
    readiness,
    metrics: platform.metrics,
    reportError,
    apiRoutes: capabilities.http,
    routes: boot.routes,
  });
  const relay = capabilities.workers ? await startWorkers(platform, boot, events) : null;

  if (listen) await http.listen({ port: config.PORT, host: config.HOST });
  const metricsServer = await startMetricsServer({
    metrics: platform.metrics,
    port: listen ? config.METRICS_PORT : 0,
    host: config.HOST,
  });
  logger.info({ modules: modules.map((m) => m.name) }, 'started');

  return {
    http,
    metricsServer,
    platform,
    boot,
    stop: async (drainMs) => {
      const steps = (async () => {
        await http.close(); // stops accepting; waits for in-flight requests
        await relay?.stop();
        await platform.jobs.close(); // waits for running jobs
        await metricsServer.close();
        await platform.redis.quit();
        await platform.db.end();
      })();
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const deadline = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`drain exceeded ${drainMs} ms`)), drainMs);
      });
      try {
        await Promise.race([steps, deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
