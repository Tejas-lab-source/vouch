// @ts-check

/**
 * A pair in canonical order, as stored in `matching.matches` (`user_low < user_high`).
 * @param {string} a
 * @param {string} b
 * @returns {[string, string]}
 */
export function canonicalPair(a, b) {
  if (a === b) throw new Error('a pair needs two different users');
  return a < b ? [a, b] : [b, a];
}

/**
 * What a like leads to, decided under the pair lock.
 * - `blocked`: either user blocked the other. Nothing is stored and nothing is revealed: the
 *   caller sees the same answer as a pass (owner decision, Phase 8).
 * - `match`: the other person already liked back, and the pair was never unmatched.
 * - `none`: no like back yet, or the pair was unmatched before (unmatch is permanent).
 * @param {{ blocked: boolean, reverseLike: boolean, previouslyUnmatched: boolean }} facts
 * @returns {'blocked' | 'match' | 'none'}
 */
export function decideMatch({ blocked, reverseLike, previouslyUnmatched }) {
  if (blocked) return 'blocked';
  if (!reverseLike || previouslyUnmatched) return 'none';
  return 'match';
}

/**
 * Who may unmatch, and what happens when they do.
 * @param {{ userLow: string, userHigh: string, unmatchedAt: Date | null, anonymisedAt: Date | null }} match
 * @param {string} userId
 * @returns {'not_member' | 'already' | 'gone' | 'unmatch'}
 */
export function judgeUnmatch(match, userId) {
  if (match.userLow !== userId && match.userHigh !== userId) return 'not_member';
  if (match.unmatchedAt) return 'already';
  if (match.anonymisedAt) return 'gone';
  return 'unmatch';
}

/** @param {{ userLow: string, userHigh: string }} match @param {string} userId */
export const otherUser = (match, userId) =>
  match.userLow === userId ? match.userHigh : match.userLow;
