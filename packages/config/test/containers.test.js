// @ts-check
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestContainers } from './containers.js';

const CONTAINER_TIMEOUT_MS = 180_000;
const CONNECT_TIMEOUT_S = 10;

describe('Testcontainers smoke test', () => {
  /** @type {import('./containers.js').TestContainers} */
  let containers;

  beforeAll(async () => {
    containers = await startTestContainers();
  }, CONTAINER_TIMEOUT_MS);

  afterAll(async () => {
    await containers?.stop();
  }, CONTAINER_TIMEOUT_MS);

  it('connects to Postgres 17', async () => {
    const sql = postgres(containers.postgresUrl, { max: 1, connect_timeout: CONNECT_TIMEOUT_S });
    try {
      const [row] = await sql`select current_setting('server_version_num')::int as version`;
      expect(row.version).toBeGreaterThanOrEqual(170000);
      expect(row.version).toBeLessThan(180000);
    } finally {
      await sql.end({ timeout: CONNECT_TIMEOUT_S });
    }
  });

  it('connects to Redis 7', async () => {
    const redis = new Redis(containers.redisUrl, {
      connectTimeout: CONNECT_TIMEOUT_S * 1000,
      commandTimeout: CONNECT_TIMEOUT_S * 1000,
      maxRetriesPerRequest: 1,
    });
    try {
      expect(await redis.ping()).toBe('PONG');
      const info = await redis.info('server');
      expect(info).toMatch(/redis_version:7\./);
    } finally {
      redis.disconnect();
    }
  });
});
