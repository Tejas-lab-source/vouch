// @ts-check
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

export const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;

/**
 * Stable JSON: object keys sorted, so equal inputs hash equally.
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Constant-time comparison of two input hashes.
 * @param {unknown} a
 * @param {string} b
 */
function sameHash(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Redis failures while claiming a key mean idempotency cannot be guaranteed: refuse clearly.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function unavailableOnError(fn) {
  try {
    return await fn();
  } catch (err) {
    throw new AppError('TEMPORARILY_UNAVAILABLE', { cause: err });
  }
}

/** @param {unknown} input */
export function hashInput(input) {
  return createHash('sha256').update(stableStringify(input)).digest('base64url');
}

/**
 * @typedef {object} IdempotencyStore
 * @property {<T>(scope: string, key: string, input: unknown, fn: () => Promise<T>) => Promise<T>} run
 */

/**
 * Stores results of idempotent writes in Redis under `platform:idem:{scope}:{key}` for 24 h.
 * - First call: marks the key pending (SET NX), runs `fn`, stores the result.
 * - Same key, same input, finished: returns the stored result without running `fn`.
 * - Same key, different input: IDEMPOTENCY_KEY_REUSED.
 * - Same key while the first call is still running: CONFLICT (the client retries later).
 * - `fn` throws: the key is released, so the client can retry.
 * @param {{ redis: import('ioredis').Redis, ttlMs?: number }} options
 * @returns {IdempotencyStore}
 */
export function createIdempotencyStore({ redis, ttlMs = IDEMPOTENCY_TTL_MS }) {
  return {
    run: async (scope, key, input, fn) => {
      const redisKey = `platform:idem:${scope}:${key}`;
      const hash = hashInput(input);
      const claimed = await unavailableOnError(() =>
        redis.set(redisKey, JSON.stringify({ state: 'pending', hash }), 'PX', ttlMs, 'NX'),
      );
      if (claimed !== 'OK') {
        const stored = JSON.parse((await unavailableOnError(() => redis.get(redisKey))) ?? '{}');
        if (!sameHash(stored.hash, hash)) throw new AppError('IDEMPOTENCY_KEY_REUSED');
        if (stored.state !== 'done') {
          throw new AppError('CONFLICT', { message: 'The same request is still being processed.' });
        }
        return stored.result;
      }
      try {
        const result = await fn();
        await redis.set(redisKey, JSON.stringify({ state: 'done', hash, result }), 'PX', ttlMs);
        return result;
      } catch (err) {
        await redis.del(redisKey);
        throw err;
      }
    },
  };
}
