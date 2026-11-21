// @ts-check
import { loadConfig } from './platform/config.js';
import { createLogger } from './platform/logger.js';
import { startErrorReporting, startTracing } from './platform/observability.js';

/**
 * Boots the process for its ROLE (api | ws | worker | all) and shuts it down gracefully on
 * SIGTERM or SIGINT: stop accepting, drain for SHUTDOWN_DRAIN_MS (default 25 s, inside the
 * host's 30 s kill), close pools.
 * @returns {Promise<void>}
 */
async function main() {
  const bootLogger = createLogger({ level: process.env.LOG_LEVEL ?? 'info' });
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    bootLogger.fatal(
      { problems: /** @type {any} */ (err).problems },
      'refusing to boot: invalid configuration',
    );
    process.exitCode = 1;
    return;
  }
  const logger = createLogger({ level: config.LOG_LEVEL, base: { role: config.ROLE } });
  const stopTracing = await startTracing({
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: 'vouch-api',
  });
  const errors = await startErrorReporting({
    dsn: config.SENTRY_DSN,
    environment: config.DEPLOY_ENV,
  });

  // Imported after tracing starts, so instrumented libraries load afterwards.
  const [{ createPlatform, startRole }, { default: modules }] = await Promise.all([
    import('./platform/boot.js'),
    import('./modules/index.js'),
  ]);

  const platform = await createPlatform({ config, logger });
  let runtime;
  try {
    runtime = await startRole({ platform, modules, reportError: errors.report });
  } catch (err) {
    logger.fatal({ err }, 'failed to start');
    process.exitCode = 1;
    await Promise.allSettled([platform.redis.quit(), platform.db.end()]);
    return;
  }

  let stopping = false;
  /** @param {NodeJS.Signals} signal */
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal, drainMs: config.SHUTDOWN_DRAIN_MS }, 'shutting down');
    try {
      await runtime.stop(config.SHUTDOWN_DRAIN_MS);
      logger.info('shutdown complete');
    } catch (err) {
      logger.error({ err }, 'shutdown did not finish cleanly');
      process.exitCode = 1;
    } finally {
      await Promise.allSettled([errors.flush(), stopTracing()]);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

await main();
