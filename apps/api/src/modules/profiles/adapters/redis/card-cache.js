// @ts-check

/** Cards are cached for 10 minutes (roadmap Phase 6). */
export const CARD_TTL_SECONDS = 600;

/** @param {string} userId */
export const cardKey = (userId) => `profiles:card:${userId}`;

/**
 * `CardCache` on Redis. Fails open: if Redis is unavailable, cards are built from Postgres.
 * @param {{ redis: import('ioredis').Redis, logger: import('pino').Logger }} deps
 * @returns {import('../../ports.js').CardCache}
 */
export function createCardCache({ redis, logger }) {
  /** @param {string} op @param {unknown} err */
  const warn = (op, err) => logger.warn({ err, op }, 'card cache unavailable');
  return {
    async getMany(userIds) {
      /** @type {Map<string, unknown>} */
      const found = new Map();
      if (userIds.length === 0) return found;
      try {
        const values = await redis.mget(userIds.map(cardKey));
        values.forEach((value, i) => {
          const id = userIds.at(i);
          if (value !== null && id !== undefined) found.set(id, JSON.parse(value));
        });
      } catch (err) {
        warn('get', err);
      }
      return found;
    },
    async setMany(cards) {
      if (cards.length === 0) return;
      try {
        const batch = redis.multi();
        for (const { userId, card } of cards) {
          batch.set(cardKey(userId), JSON.stringify(card), 'EX', CARD_TTL_SECONDS);
        }
        await batch.exec();
      } catch (err) {
        warn('set', err);
      }
    },
    async invalidate(userId) {
      try {
        await redis.del(cardKey(userId));
      } catch (err) {
        warn('invalidate', err);
      }
    },
  };
}
