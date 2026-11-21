// @ts-check

/**
 * Starts OpenTelemetry tracing when an OTLP endpoint is configured; otherwise a no-op (spans
 * from the use-case pipeline then go to the no-op tracer). For full auto-instrumentation of ESM
 * libraries, start Node with `--import @opentelemetry/auto-instrumentations-node/register`
 * (Phase 15 deploy config); this also instruments CommonJS dependencies such as `pg`.
 * @param {{ endpoint?: string, serviceName: string }} options
 * @returns {Promise<() => Promise<void>>} Shutdown function.
 */
export async function startTracing({ endpoint, serviceName }) {
  if (!endpoint) return async () => {};
  const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/auto-instrumentations-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
  ]);
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
      timeoutMillis: 5_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
    ],
    resourceDetectors: [],
  });
  sdk.start();
  return () => sdk.shutdown();
}

/**
 * Initialises Sentry when a DSN is configured. Returns a reporter for 5xx errors.
 * @param {{ dsn?: string, environment: string, release?: string }} options
 * @returns {Promise<{ report: (error: unknown) => void, flush: () => Promise<void> }>}
 */
export async function startErrorReporting({ dsn, environment, release }) {
  if (!dsn) return { report: () => {}, flush: async () => {} };
  const Sentry = await import('@sentry/node');
  Sentry.init({ dsn, environment, release, tracesSampleRate: 0 });
  return {
    report: (error) => {
      Sentry.captureException(error);
    },
    flush: async () => {
      await Sentry.flush(2_000);
    },
  };
}
