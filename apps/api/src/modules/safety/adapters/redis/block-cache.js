// @ts-check

/** Marks a set as loaded from Postgres; ids are UUIDs, so it can never collide with one. */
export const LOADED = '*loaded*';

/** @param {string} userId */
export const blockedKey = (userId) => `safety:blocked:${userId}`;

/**
 * `BlockCache` on Redis sets (no TTL: Postgres is the source of truth, and a wiped set simply
 * reloads). Loading only adds members, so it can never undo a concurrent block.
 * @param {{ redis: import('ioredis').Redis }} deps
 * @returns {import('../../ports.js').BlockCache}
 */
export function createBlockCache({ redis }) {
  return {
    add: async (a, b) => {
      await redis.multi().sadd(blockedKey(a), b).sadd(blockedKey(b), a).exec();
    },
    forget: async (a, b) => {
      await redis.del(blockedKey(a), blockedKey(b));
    },
    members: async (userId) => {
      try {
        const members = await redis.smembers(blockedKey(userId));
        if (!members.includes(LOADED)) return null;
        return new Set(members.filter((m) => m !== LOADED));
      } catch {
        return null; // Redis unavailable: callers fall back to Postgres.
      }
    },
    load: async (userId, others) => {
      await redis.sadd(blockedKey(userId), LOADED, ...others);
    },
  };
}
