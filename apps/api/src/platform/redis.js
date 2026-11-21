// @ts-check
import { Redis } from 'ioredis';

const CONNECT_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 2_000;

/**
 * @typedef {object} RedisClients
 * @property {Redis} command  General commands (cache, flags, idempotency, rate limits).
 * @property {Redis} publisher  Socket.IO adapter publisher (used from Phase 9; connects lazily).
 * @property {Redis} subscriber  Socket.IO adapter subscriber (used from Phase 9; connects lazily).
 * @property {import('bullmq').ConnectionOptions} bullmq  Options for BullMQ's own connections.
 * @property {() => Promise<void>} quit  Closes every connection.
 */

/**
 * Creates the Redis clients. Redis is disposable state: nothing here is a source of truth.
 * The command client bounds every command (2 s timeout, one retry), so when Redis is down
 * callers and readiness see errors within seconds instead of hanging requests.
 * @param {{ url: string }} options
 * @returns {RedisClients}
 */
export function createRedis({ url }) {
  const command = new Redis(url, {
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  const lazy = { connectTimeout: CONNECT_TIMEOUT_MS, lazyConnect: true };
  const publisher = new Redis(url, lazy);
  const subscriber = new Redis(url, lazy);
  // Absorb connection errors; readiness reports them and ioredis keeps reconnecting.
  for (const client of [command, publisher, subscriber]) client.on('error', () => {});

  const { hostname, port, password, username, pathname, protocol } = new URL(url);
  /** @type {import('bullmq').ConnectionOptions} */
  const bullmq = {
    host: hostname,
    port: Number(port || 6379),
    ...(username ? { username: decodeURIComponent(username) } : {}),
    ...(password ? { password: decodeURIComponent(password) } : {}),
    db: Number(pathname.slice(1) || 0),
    ...(protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    connectTimeout: CONNECT_TIMEOUT_MS,
  };

  return {
    command,
    publisher,
    subscriber,
    bullmq,
    quit: async () => {
      await Promise.allSettled(
        [command, publisher, subscriber].map((client) =>
          client.status === 'wait' || client.status === 'end' ? client.disconnect() : client.quit(),
        ),
      );
    },
  };
}
