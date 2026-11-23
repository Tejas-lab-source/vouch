// @ts-check

/** Presence lasts 60 s and is refreshed by every heartbeat (pong, every 25 s). */
export const PRESENCE_TTL_SECONDS = 60;
/** @param {string} uid */
export const presenceKey = (uid) => `chat:presence:${uid}`;

/**
 * `Presence` on Redis. Failures are ignored (presence is a hint: an unknown state counts as
 * offline, so the user may get a push they did not need).
 * @param {{ redis: import('ioredis').Redis }} deps
 * @returns {import('../../ports.js').Presence}
 */
export function createPresence({ redis }) {
  return {
    touch: async (userId) => {
      await redis.set(presenceKey(userId), '1', 'EX', PRESENCE_TTL_SECONDS).catch(() => {});
    },
    clear: async (userId) => {
      await redis.del(presenceKey(userId)).catch(() => {});
    },
    isOnline: async (userId) => (await redis.exists(presenceKey(userId)).catch(() => 0)) === 1,
  };
}
