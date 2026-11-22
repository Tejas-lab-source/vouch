// @ts-check

/** Public ids never change, so they are cached for the life of the process (bounded). */
const CACHE_MAX = 50_000;

/**
 * Turns internal ids into public ids for client-facing payloads.
 * @param {{ getUsersByIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string }[]> }} identity
 */
export function createPublicIds(identity) {
  /** @type {Map<string, string>} */
  const cache = new Map();
  /** @param {readonly string[]} ids */
  return async function publicIdsOf(ids) {
    const missing = [...new Set(ids)].filter((id) => !cache.has(id));
    if (missing.length > 0) {
      if (cache.size > CACHE_MAX) cache.clear();
      for (const u of await identity.getUsersByIds(missing)) cache.set(u.id, u.publicId);
    }
    return new Map(
      ids.flatMap((id) => (cache.has(id) ? [[id, /** @type {string} */ (cache.get(id))]] : [])),
    );
  };
}

/**
 * The `Message` contract shape.
 * @param {import('../ports.js').MessageRecord} m
 * @param {Map<string, string>} publicIds
 */
export const messageView = (m, publicIds) => ({
  conversationId: m.conversationId,
  seq: m.seq,
  clientMsgId: m.clientMsgId,
  senderId: publicIds.get(m.senderId) ?? '',
  kind: /** @type {'text'} */ (m.kind),
  body: m.body,
  createdAt: m.createdAt.toISOString(),
});

/** @param {{ userLow: string, userHigh: string }} c @param {string} me */
export const otherMember = (c, me) => (c.userLow === me ? c.userHigh : c.userLow);

/** @param {{ userLow: string, userHigh: string }} c @param {string} userId */
export const isMember = (c, userId) => c.userLow === userId || c.userHigh === userId;
