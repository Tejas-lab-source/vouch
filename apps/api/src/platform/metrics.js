// @ts-check
import Fastify from 'fastify';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Creates the metrics registry: process and event-loop metrics, HTTP RED metrics and
 * use-case metrics. Exposed only on the internal METRICS_PORT.
 */
export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, eventLoopMonitoringPrecision: 20 });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route and status.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const httpErrors = new Counter({
    name: 'http_requests_errors_total',
    help: 'HTTP responses with status 5xx.',
    labelNames: ['method', 'route'],
    registers: [registry],
  });
  const useCaseDuration = new Histogram({
    name: 'usecase_duration_seconds',
    help: 'Use-case duration by outcome.',
    labelNames: ['usecase', 'outcome'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  });

  const shed = new Counter({
    name: 'vouch_shed_total',
    help: 'Requests and socket connections refused under overload (Phase 14).',
    labelNames: ['kind', 'reason'],
    registers: [registry],
  });

  /** @type {Map<string, Gauge>} */
  const gauges = new Map();

  return {
    registry,
    /**
     * Sets a gauge, creating it on first use (modules' alert metrics, Phase 10). Names must
     * start with `vouch_`; one name always has the same help text and label names.
     * @param {string} name
     * @param {string} help
     * @param {Record<string, string>} labels
     * @param {number} value
     */
    setGauge(name, help, labels, value) {
      if (!/^vouch_[a-z_]+$/.test(name)) throw new Error(`bad gauge name ${name}`);
      let gauge = gauges.get(name);
      if (!gauge) {
        gauge = new Gauge({ name, help, labelNames: Object.keys(labels), registers: [registry] });
        gauges.set(name, gauge);
      }
      gauge.set(labels, value);
    },
    /** @param {'http' | 'socket'} kind @param {string} reason */
    countShed(kind, reason) {
      shed.inc({ kind, reason });
    },
    /**
     * @param {{ method: string, route: string, statusCode: number, seconds: number }} sample
     */
    observeHttp({ method, route, statusCode, seconds }) {
      httpDuration.observe({ method, route, status_code: String(statusCode) }, seconds);
      if (statusCode >= 500) httpErrors.inc({ method, route });
    },
    /**
     * @param {string} name
     * @param {'ok' | 'error'} outcome
     * @param {number} seconds
     */
    observeUseCase(name, outcome, seconds) {
      useCaseDuration.observe({ usecase: name, outcome }, seconds);
    },
  };
}

/** @typedef {ReturnType<typeof createMetrics>} Metrics */

/**
 * Serves `/metrics` on its own port (never the public API port).
 * @param {{ metrics: Metrics, port: number, host: string, ops?: { collect: () => Promise<void> } }} options
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startMetricsServer({ metrics, port, host, ops }) {
  const server = Fastify({ logger: false });
  server.get('/metrics', async (_request, reply) => {
    await ops?.collect();
    reply.type(metrics.registry.contentType);
    return metrics.registry.metrics();
  });
  await server.listen({ port, host });
  return server;
}

/** Scrapes faster than this reuse the last collection (one Grafana scrape a minute is normal). */
const OPS_COLLECT_MIN_INTERVAL_MS = 10_000;

/**
 * Operational gauges for the launch alerts (Phase 15), read from Postgres and Redis when
 * metrics are scraped rather than on a timer, so an idle process does no work for them:
 * - `vouch_outbox_lag_seconds`: age of the oldest unpublished outbox event (0 when none).
 * - `vouch_outbox_unpublished`: unpublished outbox events.
 * - `vouch_dead_letter_jobs{queue}`: jobs waiting in `dlq.<queue>` for inspection.
 * - `vouch_queue_oldest_waiting_seconds{queue}`: age of the oldest job waiting to start.
 * - `vouch_backup_age_seconds`: age of the newest recorded backup (absent until the first).
 * - `vouch_redis_memory_ratio`: Redis `used_memory / maxmemory` (absent without a maxmemory).
 * A failed read is logged and leaves the previous values; it never fails the scrape.
 * @param {{
 *   metrics: Metrics,
 *   db: import('./db.js').Database,
 *   jobs: import('./jobs.js').JobRunner,
 *   queueNames: readonly string[],
 *   logger: import('pino').Logger,
 *   redis?: { info: (section: string) => Promise<string> },
 *   now?: () => number,
 * }} deps
 */
export function createOpsGauges({ metrics, db, jobs, queueNames, logger, redis, now = Date.now }) {
  let lastAt = -Infinity;
  /** @type {Promise<void> | null} */
  let inFlight = null;

  const collectDatabase = async () => {
    const [outbox, backup] = await db.read('platform', (tx) =>
      Promise.all([
        tx`SELECT count(*)::int AS unpublished,
              coalesce(extract(epoch FROM now() - min(created_at)), 0)::float8 AS lag
            FROM platform.outbox WHERE published_at IS NULL`,
        tx`SELECT extract(epoch FROM now() - max(taken_at))::float8 AS age
            FROM platform.backup_runs`,
      ]),
    );
    metrics.setGauge(
      'vouch_outbox_lag_seconds',
      'Age of the oldest unpublished outbox event, in seconds (0 when none).',
      {},
      outbox[0]?.lag ?? 0,
    );
    metrics.setGauge(
      'vouch_outbox_unpublished',
      'Outbox events not yet published by the relay.',
      {},
      outbox[0]?.unpublished ?? 0,
    );
    const age = backup[0]?.age;
    if (typeof age === 'number') {
      metrics.setGauge(
        'vouch_backup_age_seconds',
        'Age of the newest recorded database backup, in seconds.',
        {},
        age,
      );
    }
  };

  /** @param {string} queue */
  const collectQueue = async (queue) => {
    const dlq = await jobs.deadLetterQueue(queue).getJobCounts('waiting', 'delayed', 'prioritized');
    metrics.setGauge(
      'vouch_dead_letter_jobs',
      'Jobs in the dead-letter queue dlq.<queue>, waiting for inspection or replay.',
      { queue },
      Object.values(dlq).reduce((a, b) => a + b, 0),
    );
    const [oldest] = await jobs.queue(queue).getJobs(['waiting'], 0, 0, true);
    metrics.setGauge(
      'vouch_queue_oldest_waiting_seconds',
      'Age of the oldest job waiting to start in a queue, in seconds (0 when none).',
      { queue },
      oldest ? Math.max(0, (now() - oldest.timestamp) / 1000) : 0,
    );
  };

  const collectRedis = async () => {
    if (!redis) return;
    const ratio = redisMemoryRatio(await redis.info('memory'));
    if (ratio !== null) {
      metrics.setGauge(
        'vouch_redis_memory_ratio',
        'Redis used_memory as a share of maxmemory (BullMQ needs noeviction: alert at 0.7).',
        {},
        ratio,
      );
    }
  };

  const collectOnce = async () => {
    const results = await Promise.allSettled([
      collectDatabase(),
      collectRedis(),
      ...queueNames.map((queue) => collectQueue(queue)),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn({ err: result.reason }, 'ops metrics collection failed');
      }
    }
  };

  return {
    /** Refreshes the gauges, at most once per 10 s; concurrent callers share one run. */
    async collect() {
      if (inFlight) return inFlight;
      if (now() - lastAt < OPS_COLLECT_MIN_INTERVAL_MS) return;
      lastAt = now();
      inFlight = collectOnce().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

/** @typedef {ReturnType<typeof createOpsGauges>} OpsGauges */

/**
 * `used_memory / maxmemory` from `INFO memory`; null when maxmemory is 0 (no limit).
 * @param {string} info
 * @returns {number | null}
 */
export function redisMemoryRatio(info) {
  const used = Number(/^used_memory:(\d+)/m.exec(info)?.[1] ?? Number.NaN);
  const max = Number(/^maxmemory:(\d+)/m.exec(info)?.[1] ?? Number.NaN);
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return null;
  return used / max;
}
