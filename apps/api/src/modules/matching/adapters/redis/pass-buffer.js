// @ts-check

export const BUFFER_KEY = 'matching:passes:buffer';
/** @param {string} uid */
export const pendingKey = (uid) => `matching:passes:pending:${uid}`;
/** Pending sets outlive a flush comfortably; written passes are excluded by SQL anyway. */
const PENDING_TTL_SECONDS = 3600;

/**
 * `PassBuffer` on Redis: a list of passes to write, and per swiper a set of targets still
 * waiting, which the deck builder excludes (owner decision, Phase 8).
 * @param {{ redis: import('ioredis').Redis }} deps
 * @returns {import('../../ports.js').PassBuffer}
 */
export function createPassBuffer({ redis }) {
  return {
    push: async (pass) => {
      const results = await redis
        .multi()
        .sadd(pendingKey(pass.swiperId), pass.targetId)
        .expire(pendingKey(pass.swiperId), PENDING_TTL_SECONDS)
        .rpush(BUFFER_KEY, JSON.stringify(pass))
        .exec();
      return Number(results?.at(2)?.[1] ?? 0);
    },
    take: async (count) => {
      const items = await redis.lpop(BUFFER_KEY, count);
      return (items ?? []).map((item) => JSON.parse(item));
    },
    pendingFor: async (swiperId) => new Set(await redis.smembers(pendingKey(swiperId))),
    settle: async (passes) => {
      if (passes.length === 0) return;
      const batch = redis.multi();
      for (const p of passes) batch.srem(pendingKey(p.swiperId), p.targetId);
      await batch.exec();
    },
    forget: async (userId) => {
      await redis.del(pendingKey(userId));
    },
  };
}
