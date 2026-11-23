// @ts-check

/**
 * Public in-process API of safety. Other modules call only this.
 * - `blockPolicy.isBlocked(a, b, { tx? })`: either user blocked the other (Redis, then SQL).
 * - `blockPolicy.blockedAmong(viewerId, ids)`: the ids the viewer must not see.
 * - `isBanned(userId)`, `bannedAmong(ids)`: active bans (filled from Phase 10).
 * - `blockersBetween(a, b)`: which of the two blocked the other (Phase 9, for close notices).
 * - `unblock({ blockerId, blockedId })`: staff remove a block (admin only, Phase 10).
 * - `moderation`: the admin module's calls (Phase 10): reports, actions, bans, ID-card
 *   reviews, the photo review queue and user facts. Admin checks the token and audits.
 * @param {ReturnType<typeof import('./adapters/wiring.js').buildSafetyHandlers>} handlers
 */
export function createSafetyApi(handlers) {
  return {
    blockPolicy: handlers.blockPolicy,
    isBanned: handlers.bans.isBanned,
    bannedAmong: handlers.bans.bannedAmong,
    blockersBetween: handlers.blockersBetween,
    unblock: handlers.unblock,
    moderation: handlers.admin,
  };
}

/** @typedef {ReturnType<typeof createSafetyApi>} SafetyApi */
