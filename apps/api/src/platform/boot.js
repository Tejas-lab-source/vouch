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
import { createPressureGauge } from './pressure.js';
import { buildHttpServer } from './http.js';
import { createIdGenerator } from './ids.js';
import { createIdempotencyStore } from './idempotency.js';
import { createJobs, QUEUE_POLICIES } from './jobs.js';
import { configRoute } from './config-route.js';
import { createSemaphore } from './semaphore.js';
import { CONSISTENCY_CRON, createConsistencyCheck } from './jobs/consistency.js';
import { createMetrics, createOpsGauges, startMetricsServer } from './metrics.js';
import { createPipelines } from './pipelines.js';
import { createRateLimiter } from './rate-limit.js';
import { createRedis } from './redis.js';
import { bootModules, capabilitiesOf } from './registry.js';
import { createUnitOfWork } from './uow.js';
import { createUseCaseFactory } from './use-case.js';
import { createSocketEmitter, createSocketGateway } from './ws.js';

/** Nightly retention of event bookkeeping, 03:17 UTC (off the hour). */
const RETENTION_CRON = '17 3 * * *';

/**
 * @typedef {object} Runtime
 * @property {import('fastify').FastifyInstance} http  Public server (/health, /ready, routes).
 * @property {import('fastify').FastifyInstance} metricsServer  Internal /metrics server.
 * @property {Record<string, any>} platform  The services injected into modules.
 * @property {import('./registry.js').BootResult} boot
 * @property {import('./ws.js').SocketGateway | null} gateway  The socket gateway (`ws`, `all`).
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
    replicaUrl: config.DATABASE_REPLICA_URL,
  });
  const redis = createRedis({ url: config.REDIS_URL });
  const metrics = createMetrics();
  const jobs = createJobs({
    connection: redis.bullmq,
    logger,
    concurrency: { media: config.IMAGE_WORKER_CONCURRENCY },
  });
  const flags = createFlags({ db, redis: redis.command, logger });
  const idempotency = createIdempotencyStore({ redis: redis.command });
  const pipelines = createPipelines({ logger });
  const rateLimiter = createRateLimiter({ redis: redis.command, logger });
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
    rateLimiter,
    useCase,
    verifier,
    /** Server events to users' rooms, from any role (`emitToUser`). */
    sockets: createSocketEmitter({ redis: redis.command, logger }),
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
  // Half the pool for consumer transactions; the rest stays free for the reads they make
  // through other modules' APIs and for jobs (see events/consume.js).
  const consumerSlots = createSemaphore(
    Math.max(1, Math.floor(platform.config.DATABASE_POOL_MAX / 2)),
  );

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
        slots: consumerSlots,
      }),
    );
  }
  for (const { queue, name, handler } of boot.jobs) handle(queue, name, handler);

  handle('bulk', 'platform.retention', async (/** @type {any} */ job) => {
    const { task, olderThan } = job.data;
    if (task !== 'outbox' && task !== 'inbox' && task !== 'deletionTasks') {
      return { skipped: task };
    }
    return { deleted: await purgeEvents(db, task, new Date(olderThan)) };
  });
  handle('bulk', 'platform.retentionTick', async () => {
    const now = platform.clock.now().getTime();
    for (const task of /** @type {const} */ (['outbox', 'inbox', 'deletionTasks'])) {
      await jobs.add('platform.retention', {
        task,
        olderThan: new Date(
          now - (new Map(Object.entries(EVENT_RETENTION)).get(task) ?? 0),
        ).toISOString(),
      });
    }
  });
  await jobs.schedule('platform.retention-tick', RETENTION_CRON, 'platform.retentionTick', {});
  handle(
    'bulk',
    'platform.consistencyCheck',
    createConsistencyCheck({
      db,
      logger,
      metrics: platform.metrics,
      clock: platform.clock,
      subscriptions: boot.subscriptions,
    }),
  );
  await jobs.schedule(
    'platform.consistency-check',
    CONSISTENCY_CRON,
    'platform.consistencyCheck',
    {},
  );

  for (const { id, cron, job } of boot.schedules) await jobs.schedule(id, cron, job, {});

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
  const pressure = createPressureGauge({
    maxEventLoopDelayMs: config.PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
    maxHeapRatio: config.PRESSURE_MAX_HEAP_RATIO,
  });
  // Every queue this deployment uses: the policy queues and one per consuming module.
  const queueNames = [
    ...Object.keys(QUEUE_POLICIES).filter((name) => name !== 'events'),
    ...new Set(boot.consumers.map(({ module }) => eventQueueName(module))),
  ];
  const ops = createOpsGauges({
    metrics: platform.metrics,
    db: platform.db,
    jobs: platform.jobs,
    queueNames,
    logger,
  });
  const http = await buildHttpServer({
    pressure,
    ops,
    config,
    logger,
    verifier: platform.verifier,
    redis: platform.redis.command,
    readiness,
    metrics: platform.metrics,
    reportError,
    apiRoutes: capabilities.http,
    routes: capabilities.http
      ? [
          ...boot.routes,
          {
            module: 'platform',
            plugin: configRoute({
              config,
              db: platform.db,
              flags: platform.flags,
              apis: boot.apis,
              sections: boot.sections,
            }),
          },
        ]
      : boot.routes,
  });
  const relay = capabilities.workers ? await startWorkers(platform, boot, events) : null;
  const gateway = capabilities.socket
    ? createSocketGateway({
        server: http.server,
        config,
        logger,
        verifier: platform.verifier,
        redis: platform.redis,
        clock: platform.clock,
        pressure,
        metrics: platform.metrics,
        modules: boot.socketHandlers.map(({ module, handlers }) => ({
          module,
          handlers: /** @type {import('./ws.js').SocketHandlers} */ (handlers),
        })),
      })
    : null;

  if (listen) await http.listen({ port: config.PORT, host: config.HOST });
  const metricsServer = await startMetricsServer({
    metrics: platform.metrics,
    ops,
    port: listen ? config.METRICS_PORT : 0,
    host: config.HOST,
  });
  logger.info({ modules: modules.map((m) => m.name) }, 'started');

  return {
    http,
    metricsServer,
    platform,
    boot,
    gateway,
    stop: async (drainMs) => {
      const steps = (async () => {
        await gateway?.drain(drainMs); // sockets leave gradually before HTTP closes
        await http.close(); // stops accepting; waits for in-flight requests
        await relay?.stop();
        await platform.jobs.close(); // waits for running jobs
        await metricsServer.close();
        await platform.redis.quit();
        await platform.db.end();
        pressure.stop();
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
