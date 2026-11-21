// @ts-check
import { buildApp } from './app.js';

/** How long to wait for in-flight requests before forcing the process to exit. */
const SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const MAX_PORT = 65_535;

/**
 * Parses a TCP port from an environment value.
 * @param {string | undefined} value
 * @returns {number}
 * @throws {Error} when the value is not an integer between 0 and 65535.
 */
function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  return port;
}

/**
 * Closes the server on SIGTERM or SIGINT, forcing an exit if closing hangs.
 * @param {import('fastify').FastifyInstance} app
 * @returns {void}
 */
function registerGracefulShutdown(app) {
  let closing = false;

  /** @param {NodeJS.Signals} signal */
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      app.log.error('shutdown timed out; forcing exit');
      // eslint-disable-next-line n/no-process-exit -- last resort when close() hangs
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await app.close();
      app.log.info('shutdown complete');
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

/**
 * Boots the API process.
 * @returns {Promise<void>}
 */
async function start() {
  const app = buildApp({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  try {
    const port = parsePort(process.env.PORT);
    const host = process.env.HOST || DEFAULT_HOST;
    registerGracefulShutdown(app);
    await app.listen({ port, host });
  } catch (err) {
    app.log.fatal({ err }, 'failed to start');
    process.exitCode = 1;
    await app.close();
  }
}

await start();
