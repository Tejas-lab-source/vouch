// @ts-check
import Fastify from 'fastify';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

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

  return {
    registry,
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
