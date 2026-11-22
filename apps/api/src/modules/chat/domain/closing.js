// @ts-check

/** @typedef {'unmatched' | 'blocked' | 'banned' | 'deleted'} CloseReason */

/**
 * What each member is told when a conversation closes (owner decision, Phase 9): moderation is
 * never revealed. A blocker is told `blocked`; the person blocked, or the other side of a ban,
 * is told `unmatched`, exactly like an ordinary unmatch; the banned user is told `banned`; when
 * an account is deleted the other person is told `deleted` and the deleted user nothing.
 * @param {{ userLow: string, userHigh: string }} conversation
 * @param {{ blockers: readonly string[], deleted: readonly string[], banned: readonly string[] }} facts
 * @returns {Map<string, CloseReason>}  Member → reason; members missing are not told.
 */
export function closeNotices({ userLow, userHigh }, { blockers, deleted, banned }) {
  /** @type {Map<string, CloseReason>} */
  const notices = new Map();
  for (const [me, other] of [
    [userLow, userHigh],
    [userHigh, userLow],
  ]) {
    if (deleted.includes(me)) continue;
    if (blockers.includes(me)) notices.set(me, 'blocked');
    else if (deleted.includes(other)) notices.set(me, 'deleted');
    else if (banned.includes(me)) notices.set(me, 'banned');
    else notices.set(me, 'unmatched');
  }
  return notices;
}
