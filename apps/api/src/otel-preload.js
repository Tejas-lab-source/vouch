// @ts-check
/**
 * Loaded before the app with `node --import ./src/otel-preload.js` (the Docker image's CMD).
 * When an OTLP endpoint is configured it registers OpenTelemetry's ESM loader hook and starts
 * the SDK *before* any library is imported, so ESM libraries (Fastify, postgres.js, ioredis,
 * undici) are traced too (Phase 4 note, done in Phase 15). Without an endpoint it does
 * nothing: no SDK, no export attempts.
 *
 * The SDK reads its settings from the standard OTEL_* variables; defaults are set here.
 * `startTracing` in platform/observability.js sees the flag and does not start a second SDK.
 */
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  process.env.OTEL_SERVICE_NAME ??= 'vouch-api';
  process.env.OTEL_TRACES_EXPORTER ??= 'otlp';
  process.env.OTEL_METRICS_EXPORTER ??= 'none';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
  process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS ??= 'fs';
  process.env.OTEL_NODE_RESOURCE_DETECTORS ??= 'env,host';
  await import('@opentelemetry/auto-instrumentations-node/register');
  /** @type {any} */ (globalThis).__vouchOtelPreloaded = true;
}
