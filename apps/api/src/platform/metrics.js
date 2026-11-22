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
 * @param {{ metrics: Metrics, port: number, host: string }} options
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startMetricsServer({ metrics, port, host }) {
  const server = Fastify({ logger: false });
  server.get('/metrics', async (_request, reply) => {
    reply.type(metrics.registry.contentType);
    return metrics.registry.metrics();
  });
  await server.listen({ port, host });
  return server;
}
