// @ts-check

/**
 * Public in-process API of matching. Other modules call only this.
 * - `areMatched(a, b)`: whether the two users have an active match.
 * - `getMatch(matchId)`: `{ id, userLow, userHigh, createdAt, unmatchedAt, anonymisedAt }` or null.
 * - `likesIn(userId)`: how many people liked the user and are still unanswered (a count only).
 * @param {ReturnType<typeof import('./adapters/wiring.js').buildMatchingHandlers>} handlers
 */
export function createMatchingApi({ areMatched, getMatch, likesIn }) {
  return { areMatched, getMatch, likesIn };
}
