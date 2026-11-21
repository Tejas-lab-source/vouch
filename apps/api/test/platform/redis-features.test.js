// @ts-check
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/platform/db.js';
import { FLAG_CACHE_KEY, createFlags } from '../../src/platform/flags.js';
import { createIdempotencyStore, hashInput } from '../../src/platform/idempotency.js';
import { createRedis } from '../../src/platform/redis.js';
import { HOOK_TIMEOUT_MS, startInfra } from './helpers.js';

const logger = pino({ level: 'silent' });

describe('Redis-backed platform features', () => {
  /** @type {import('./helpers.js').Infra} */
  let infra;
  /** @type {import('../../src/platform/redis.js').RedisClients} */
  let redis;
  /** @type {import('../../src/platform/db.js').Database} */
  let db;

  beforeAll(async () => {
    infra = await startInfra();
    redis = createRedis({ url: infra.redisUrl });
    db = createDatabase({ url: infra.appUrl });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await redis?.quit();
    await db?.end();
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  describe('idempotency store', () => {
    it('the same key twice returns the stored result and runs the handler once', async () => {
      const store = createIdempotencyStore({ redis: redis.command });
      let runs = 0;
      const handler = async () => ({ run: ++runs });
      const first = await store.run('demo:u1', 'key-1-abcdef', { a: 1 }, handler);
      const second = await store.run('demo:u1', 'key-1-abcdef', { a: 1 }, handler);
      expect(first).toEqual({ run: 1 });
      expect(second).toEqual({ run: 1 });
      expect(runs).toBe(1);
      expect(await redis.command.pttl('platform:idem:demo:u1:key-1-abcdef')).toBeGreaterThan(
        23 * 3600 * 1000,
      );
    });

    it('reusing a key with a different input is refused', async () => {
      const store = createIdempotencyStore({ redis: redis.command });
      await store.run('demo:u1', 'key-2-abcdef', { a: 1 }, async () => 'ok');
      await expect(
        store.run('demo:u1', 'key-2-abcdef', { a: 2 }, async () => 'ok'),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    });

    it('a duplicate while the first call is still running gets CONFLICT', async () => {
      const store = createIdempotencyStore({ redis: redis.command });
      /** @type {(value?: unknown) => void} */
      let release = () => {};
      const first = store.run(
        'demo:u1',
        'key-3-abcdef',
        {},
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(store.run('demo:u1', 'key-3-abcdef', {}, async () => 'x')).rejects.toMatchObject(
        { code: 'CONFLICT' },
      );
      release('done');
      expect(await first).toBe('done');
    });

    it('a failed call releases the key so the client can retry', async () => {
      const store = createIdempotencyStore({ redis: redis.command });
      await expect(
        store.run('demo:u1', 'key-4-abcdef', {}, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await store.run('demo:u1', 'key-4-abcdef', {}, async () => 'retried')).toBe('retried');
    });

    it('scopes keys per caller and hashes inputs independently of key order', async () => {
      const store = createIdempotencyStore({ redis: redis.command });
      expect(await store.run('demo:u1', 'key-5-abcdef', {}, async () => 'u1')).toBe('u1');
      expect(await store.run('demo:u2', 'key-5-abcdef', {}, async () => 'u2')).toBe('u2');
      expect(hashInput({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
        hashInput({ b: [1, { d: 3, c: 2 }], a: 1 }),
      );
    });
  });

  describe('feature flags', () => {
    it('reads flags from Postgres, caches them for 30 s, and serves the cache', async () => {
      await infra.admin`INSERT INTO platform.feature_flags (key, enabled, rules)
        VALUES ('demo.cached', true, ${infra.admin.json([{ type: 'platform', platforms: ['ios'] }])})`;
      const flags = createFlags({ db, redis: redis.command, logger });
      expect(await flags.isEnabled('demo.cached', { platform: 'ios' })).toBe(true);
      expect(await flags.isEnabled('demo.cached', { platform: 'web' })).toBe(false);
      const ttl = await redis.command.ttl(FLAG_CACHE_KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);

      await infra.admin`UPDATE platform.feature_flags SET enabled = false WHERE key = 'demo.cached'`;
      expect(await flags.isEnabled('demo.cached', { platform: 'ios' })).toBe(true); // still cached
      await flags.invalidate();
      expect(await flags.isEnabled('demo.cached', { platform: 'ios' })).toBe(false);
      expect(await flags.evaluateAll({ platform: 'ios' })).toMatchObject({ 'demo.cached': false });
    });

    it('falls back to Postgres when Redis is unavailable', async () => {
      await infra.admin`INSERT INTO platform.feature_flags (key, enabled) VALUES ('demo.fallback', true)`;
      const broken = createRedis({ url: 'redis://127.0.0.1:1' });
      const flags = createFlags({ db, redis: broken.command, logger });
      expect(await flags.isEnabled('demo.fallback')).toBe(true);
      await broken.quit();
    });
  });
});
