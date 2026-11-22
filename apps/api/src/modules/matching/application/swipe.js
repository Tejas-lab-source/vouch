// @ts-check
import { matchCreated, ServiceError } from '@vouch/contracts';
import { canonicalPair, decideMatch } from '../domain/pair.js';

/** What every swipe that does not create or find a match returns, including blocked pairs. */
const NO_MATCH = Object.freeze({ matched: false, matchId: null });

/** Thrown inside the like transaction to roll it back when the pair turns out to be blocked. */
class BlockedPair extends Error {}

/**
 * `POST /v1/swipes` (ADR 0016). Idempotent on `swipeId` (the stored result is replayed) and on
 * the pair (the first swipe wins). A blocked pair is never revealed: the answer is the same as
 * a pass and nothing is stored.
 * @param {import('../ports.js').MatchingDeps} deps
 */
export function makeSwipe(deps) {
  const { useCase, uow, read, passes, queue, lockPair, identity, profiles, discovery, safety } =
    deps;
  const { clock, newId, observeLockHold } = deps;

  /**
   * One transaction: insert the like, take the pair lock, re-check the block on the same
   * transaction, look for the like back, and create the match at most once.
   * @param {string} me
   * @param {string} targetId
   */
  async function like(me, targetId) {
    const at = clock.now();
    /** @type {number | null} */
    let lockedAt = null;
    try {
      const result = await uow.run(async ({ tx, stores, emit }) => {
        await stores.swipes.insertLike(me, targetId, at);
        await lockPair(tx, me, targetId);
        lockedAt = performance.now();
        const [low, high] = canonicalPair(me, targetId);
        const decision = decideMatch({
          blocked: await safety.blockPolicy.isBlocked(me, targetId, { tx }),
          ...(await stores.swipes.pairState(me, targetId, low, high)),
        });
        if (decision === 'blocked') throw new BlockedPair();
        if (decision === 'none') return NO_MATCH;
        const { match, created } = await stores.matches.createOrGet({
          id: newId(),
          userLow: low,
          userHigh: high,
          at,
        });
        if (created) {
          await emit(matchCreated, {
            matchId: match.id,
            userLow: low,
            userHigh: high,
            firstLikerId: targetId,
            createdAt: at.toISOString(),
          });
        }
        return { matched: true, matchId: match.id };
      });
      return result;
    } catch (error) {
      if (error instanceof BlockedPair) return NO_MATCH;
      throw error;
    } finally {
      if (lockedAt !== null) observeLockHold(performance.now() - lockedAt);
    }
  }

  /**
   * Buffers a pass (written in batches by `matching.flushPasses`).
   * @param {string} me
   * @param {string} targetId
   */
  async function pass(me, targetId) {
    const length = await passes.push({
      swiperId: me,
      targetId,
      swipedAt: clock.now().toISOString(),
    });
    if (length >= 500) await queue.enqueueFlush();
    return NO_MATCH;
  }

  const swipe = useCase(
    'matching.swipe',
    /** @param {{ swipeId: string, targetId: string, direction: 'like' | 'pass' }} input */
    async (input, ctx) => {
      const me = /** @type {string} */ (ctx.actor?.userId);
      const [target] = await identity.getUsersByPublicIds([input.targetId]);
      if (!target || target.status === 'deleted') throw new ServiceError('NOT_FOUND');
      if (target.id === me) {
        throw new ServiceError('VALIDATION_FAILED', { message: 'You cannot swipe yourself.' });
      }
      if (!(await profiles.isActive(me))) throw new ServiceError('PROFILE_INCOMPLETE');
      // Checked before anything that could differ for a blocked pair, so the answer reveals
      // nothing.
      if (await safety.blockPolicy.isBlocked(me, target.id)) return NO_MATCH;
      const [low, high] = canonicalPair(me, target.id);
      const existing = await read((stores) => stores.matches.findPair(low, high));
      if (existing && !existing.unmatchedAt && !existing.anonymisedAt) {
        return { matched: true, matchId: existing.id };
      }
      if (!(await discovery.wasServed(me, target.id))) throw new ServiceError('NOT_SERVED');
      return input.direction === 'like' ? like(me, target.id) : pass(me, target.id);
    },
    { idempotent: true },
  );

  return { swipe, like };
}
