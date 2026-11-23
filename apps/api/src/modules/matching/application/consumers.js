// @ts-check
import { matchUnmatched } from '@vouch/contracts';
import { canonicalPair, otherUser } from '../domain/pair.js';

/**
 * Consumers. Each runs in the inbox transaction (`scope`), with outbox emit.
 * @param {Pick<import('../ports.js').MatchingDeps, 'passes' | 'clock' | 'newId'>} deps
 */
export function makeMatchingConsumers({ passes, clock, newId }) {
  /**
   * @typedef {{ stores: import('../ports.js').MatchingStores, emit: (event: any, payload: unknown) => Promise<number> }} Scope
   */

  /**
   * Ends a match without a user action (a block, a deletion).
   * @param {Scope} scope
   * @param {import('../ports.js').MatchRecord} match
   * @param {Date} at
   */
  async function end({ stores, emit }, match, at) {
    await stores.matches.setUnmatched(match.id, at);
    await emit(matchUnmatched, {
      matchId: match.id,
      userLow: match.userLow,
      userHigh: match.userHigh,
      unmatchedBy: null,
      unmatchedAt: at.toISOString(),
    });
  }

  return {
    /**
     * `user.blocked.v1`: an active match between the pair ends (`unmatchedBy: null`).
     * @param {{ blockerId: string, blockedId: string }} payload
     * @param {Scope} scope
     */
    async onUserBlocked({ blockerId, blockedId }, scope) {
      const [low, high] = canonicalPair(blockerId, blockedId);
      const match = await scope.stores.matches.findPair(low, high);
      if (match && !match.unmatchedAt && !match.anonymisedAt) await end(scope, match, clock.now());
    },

    /**
     * `user.banned.v1` (Phase 10): every active match of the banned user ends
     * (`unmatchedBy: null`), so chat closes the conversations; the other person is told
     * `unmatched`, exactly as for an unmatch. Lifting the ban does not restore matches.
     * @param {{ userId: string }} payload
     * @param {Scope} scope
     */
    async onUserBanned({ userId }, scope) {
      const at = clock.now();
      for (const match of await scope.stores.matches.allForUser(userId)) {
        if (!match.unmatchedAt && !match.anonymisedAt) await end(scope, match, at);
      }
    },

    /**
     * `user.deleted.v1`: delete the user's swipes (both directions), end active matches, and
     * anonymise every match: the user's id becomes a random tombstone, in canonical order.
     * @param {{ userId: string }} payload
     * @param {Scope} scope
     */
    async onUserDeleted({ userId }, scope) {
      const at = clock.now();
      await scope.stores.swipes.removeForUser(userId);
      for (const match of await scope.stores.matches.allForUser(userId)) {
        // Even if the other person was deleted first (already anonymised), this user's id is
        // replaced too.
        if (!match.unmatchedAt && !match.anonymisedAt) await end(scope, match, at);
        const [low, high] = canonicalPair(otherUser(match, userId), newId());
        await scope.stores.matches.anonymise(match.id, low, high, at);
      }
      await passes.forget(userId);
    },
  };
}
