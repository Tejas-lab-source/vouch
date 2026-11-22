// @ts-check

/**
 * Public in-process API of safety. Other modules call only this.
 * - `blockPolicy.isBlocked(a, b, { tx? })`: either user blocked the other (Redis, then SQL).
 * - `blockPolicy.blockedAmong(viewerId, ids)`: the ids the viewer must not see.
 * - `isBanned(userId)`, `bannedAmong(ids)`: active bans (filled from Phase 10).
 * @param {ReturnType<typeof import('./adapters/wiring.js').buildSafetyHandlers>} handlers
 */
export function createSafetyApi(handlers) {
  return {
    blockPolicy: handlers.blockPolicy,
    isBanned: handlers.bans.isBanned,
    bannedAmong: handlers.bans.bannedAmong,
  };
}

/** @typedef {ReturnType<typeof createSafetyApi>} SafetyApi */
