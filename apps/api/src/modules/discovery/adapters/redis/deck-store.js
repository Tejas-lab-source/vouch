// @ts-check
import { DECK } from '../../domain/deck.js';

/** @param {string} uid */
export const deckKey = (uid) => `discovery:deck:${uid}`;
/** @param {string} uid */
export const servedKey = (uid) => `discovery:served:${uid}`;
/** @param {string} day @param {string} uid */
export const exposureKey = (day, uid) => `discovery:exposure:${day}:${uid}`;

/** Exposure counters outlive their day a little, so a late read still finds them. */
const EXPOSURE_TTL_SECONDS = 48 * 3600;

/**
 * `DeckStore` on Redis (ARCHITECTURE.md 7.4).
 * @param {{ redis: import('ioredis').Redis }} deps
 * @returns {import('../../ports.js').DeckStore}
 */
export function createDeckStore({ redis }) {
  return {
    write: async (uid, ids) => {
      // The served set is kept: it has its own 24-hour TTL, and a rebuild queued right after a
      // page was served (a refill) must not make those cards unswipeable (NOT_SERVED).
      const batch = redis.multi().del(deckKey(uid));
      if (ids.length > 0) batch.rpush(deckKey(uid), ...ids).expire(deckKey(uid), DECK.ttlSeconds);
      await batch.exec();
    },
    pop: async (uid, count) => {
      const [[, exists], [, ids]] = /** @type {[any, any][]} */ (
        await redis.multi().exists(deckKey(uid)).lpop(deckKey(uid), count).exec()
      );
      if (!exists) return null;
      return ids ?? [];
    },
    remaining: (uid) => redis.llen(deckKey(uid)),
    markServed: async (uid, ids) => {
      await redis
        .multi()
        .sadd(servedKey(uid), ...ids)
        .expire(servedKey(uid), DECK.ttlSeconds)
        .exec();
    },
    wasServed: async (uid, targetId) => (await redis.sismember(servedKey(uid), targetId)) === 1,
    remove: async (uid, otherId) => {
      await redis.lrem(deckKey(uid), 0, otherId);
    },
    drop: async (uid) => {
      await redis.del(deckKey(uid));
    },
    exposure: async (ids, day) => {
      /** @type {Map<string, number>} */
      const counts = new Map();
      if (ids.length === 0) return counts;
      const values = await redis.mget(ids.map((id) => exposureKey(day, id)));
      values.forEach((value, i) => {
        const id = ids.at(i);
        if (id !== undefined && value !== null) counts.set(id, Number(value));
      });
      return counts;
    },
    countExposure: async (ids, day) => {
      const batch = redis.multi();
      for (const id of ids) {
        batch.incr(exposureKey(day, id)).expire(exposureKey(day, id), EXPOSURE_TTL_SECONDS);
      }
      await batch.exec();
    },
  };
}
