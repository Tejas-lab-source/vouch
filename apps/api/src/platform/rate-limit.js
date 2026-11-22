// @ts-check
import { AppError } from './errors.js';

/**
 * @typedef {object} Limit
 * @property {string} key  Without prefix, for example `otp:email:<hmac>`.
 * @property {number} max  Requests allowed per window.
 * @property {number} windowMs
 */

/**
 * Fixed-window rate limiter in Redis (`platform:rl:{key}`), for limits a use case owns.
 * - Over the limit: RATE_LIMITED, with `retryAfterMs`.
 * - Redis unavailable: `failClosed` refuses with TEMPORARILY_UNAVAILABLE (OTP requests);
 *   otherwise the request is allowed and the failure logged (fail open).
 * @param {{ redis: import('ioredis').Redis, logger: import('pino').Logger }} deps
 */
export function createRateLimiter({ redis, logger }) {
  return {
    /**
     * Counts one hit against every limit; throws when any is exceeded.
     * @param {Limit[]} limits
     * @param {{ failClosed?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async hit(limits, { failClosed = false } = {}) {
      /** @type {[number, number][]} */
      let results;
      try {
        const pipeline = redis.multi();
        for (const { key, windowMs } of limits) {
          pipeline.incr(`platform:rl:${key}`);
          pipeline.pexpire(`platform:rl:${key}`, windowMs, 'NX');
          pipeline.pttl(`platform:rl:${key}`);
        }
        const replies = (await pipeline.exec()) ?? [];
        if (replies.some(([err]) => err)) throw new Error('rate limiter command failed');
        results = limits.map((_, i) => [
          Number(replies.at(i * 3)?.[1]),
          Number(replies.at(i * 3 + 2)?.[1]),
        ]);
      } catch (err) {
        if (failClosed) {
          logger.error({ err }, 'rate limiter unavailable; refusing (fail closed)');
          throw new AppError('TEMPORARILY_UNAVAILABLE', { cause: err });
        }
        logger.warn({ err }, 'rate limiter unavailable; allowing (fail open)');
        return;
      }
      limits.forEach((limit, i) => {
        const [count, ttl] = results.at(i) ?? [0, 0];
        if (count > limit.max) {
          throw new AppError('RATE_LIMITED', { details: { retryAfterMs: Math.max(ttl, 0) } });
        }
      });
    },
  };
}

/** @typedef {ReturnType<typeof createRateLimiter>} RateLimiter */
