// @ts-check
import { matchUnmatched, ServiceError } from '@vouch/contracts';
import { decodeCursor, encodeCursor } from '../domain/cursor.js';
import { canonicalPair, judgeUnmatch, otherUser } from '../domain/pair.js';

/**
 * Matches: unmatch, the match list, the incoming-likes count and the public API queries.
 * @param {import('../ports.js').MatchingDeps} deps
 */
export function makeMatches(deps) {
  const { useCase, uow, read, identity, profiles, clock } = deps;

  const unmatch = useCase(
    'matching.unmatch',
    /** @param {{ id: string }} input */
    async (input, ctx) => {
      const me = /** @type {string} */ (ctx.actor?.userId);
      return uow.run(async ({ stores, emit }) => {
        const match = await stores.matches.findForUpdate(input.id);
        const verdict = match ? judgeUnmatch(match, me) : 'not_member';
        if (!match || verdict === 'not_member') throw new ServiceError('NOT_FOUND');
        if (verdict === 'gone') throw new ServiceError('NOT_MATCHED');
        if (verdict === 'already') {
          return {
            matchId: match.id,
            unmatchedAt: /** @type {Date} */ (match.unmatchedAt).toISOString(),
          };
        }
        const at = clock.now();
        await stores.matches.setUnmatched(match.id, at);
        await emit(matchUnmatched, {
          matchId: match.id,
          userLow: match.userLow,
          userHigh: match.userHigh,
          unmatchedBy: me,
          unmatchedAt: at.toISOString(),
        });
        return { matchId: match.id, unmatchedAt: at.toISOString() };
      });
    },
  );

  const listMatches = useCase(
    'matching.listMatches',
    /** @param {{ cursor?: string, limit: number }} input */
    async (input, ctx) => {
      const me = /** @type {string} */ (ctx.actor?.userId);
      const rows = await read((stores) =>
        stores.matches.activeForUser(me, decodeCursor(input.cursor), input.limit + 1),
      );
      const pageRows = rows.slice(0, input.limit);
      const others = pageRows.map((m) => otherUser(m, me));
      const [cards, users] = await Promise.all([
        profiles.getCards(others),
        identity.getUsersByIds(others),
      ]);
      const publicIds = new Map(users.map((u) => [u.id, u.publicId]));
      const cardByPublicId = new Map(cards.map((c) => [c.userId, c]));
      // A match whose other person cannot be shown (inactive, banned) is left out.
      const items = pageRows.flatMap((m) => {
        const card = cardByPublicId.get(publicIds.get(otherUser(m, me)) ?? '');
        return card
          ? [
              {
                matchId: m.id,
                // The conversation id is the match id (Phase 9, ADR 0017).
                conversationId: m.id,
                user: card,
                createdAt: m.createdAt.toISOString(),
              },
            ]
          : [];
      });
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor: rows.length > input.limit && last ? encodeCursor(last) : null,
      };
    },
  );

  /**
   * People who liked the user and whom the user has not swiped yet: a count only, never who
   * (who-liked-you is a later premium feature).
   * @param {string} userId
   */
  const likesIn = (userId) => read((stores) => stores.swipes.likesInCount(userId));

  /** @param {string} a @param {string} b */
  async function areMatched(a, b) {
    if (a === b) return false;
    const [low, high] = canonicalPair(a, b);
    const match = await read((stores) => stores.matches.findPair(low, high));
    return Boolean(match && !match.unmatchedAt && !match.anonymisedAt);
  }

  /** @param {string} matchId */
  const getMatch = (matchId) => read((stores) => stores.matches.find(matchId));

  /**
   * Users with unanswered likes, in id order, for the daily digest (counts only, Phase 10).
   * @param {{ afterId: string | null, limit: number }} page
   * @returns {Promise<{ userId: string, likes: number }[]>}
   */
  const pendingLikes = ({ afterId, limit }) =>
    read((stores) => stores.swipes.pendingLikesBatch(afterId, limit));
  return { unmatch, listMatches, likesIn, pendingLikes, areMatched, getMatch };
}
