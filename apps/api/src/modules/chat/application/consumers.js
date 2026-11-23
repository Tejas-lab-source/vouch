// @ts-check
import { createPublicIds } from './views.js';

/**
 * Consumers (inbox transaction as `vouch_chat`; socket events go out after commit).
 * @param {import('../ports.js').ChatDeps & {
 *   openConversation: (matchId: string) => Promise<import('../ports.js').ConversationRecord | null>,
 *   closeConversation: (stores: import('../ports.js').ChatStores, id: string, afterCommit: (fn: () => unknown) => void) => Promise<boolean>,
 * }} deps
 */
export function makeChatConsumers(deps) {
  const { identity, profiles, sockets, openConversation, closeConversation } = deps;
  const publicIdsOf = createPublicIds(identity);

  /** @typedef {{ stores: import('../ports.js').ChatStores, afterCommit: (fn: () => unknown) => void }} Scope */

  return {
    /**
     * `match.created.v1`: open the conversation, then tell both users (`match.new`, each with
     * the other's card; a user whose card cannot be shown is not announced to the other).
     * @param {{ matchId: string, userLow: string, userHigh: string }} payload
     * @param {Scope} scope
     */
    async onMatchCreated({ matchId, userLow, userHigh }, scope) {
      const conversation = await openConversation(matchId);
      const cards = await profiles.getCards([userLow, userHigh]);
      const ids = await publicIdsOf([userLow, userHigh]);
      const cardOf = (/** @type {string} */ id) => cards.find((c) => c.userId === ids.get(id));
      scope.afterCommit(() => {
        for (const [me, other] of [
          [userLow, userHigh],
          [userHigh, userLow],
        ]) {
          const user = cardOf(other);
          if (user) {
            sockets.emitToUser(me, 'match.new', {
              matchId,
              conversationId: conversation?.id ?? null,
              user,
            });
          }
        }
      });
    },

    /** `match.unmatched.v1`: close (the notices depend on why; see `domain/closing.js`). */
    onMatchUnmatched: async (
      /** @type {{ matchId: string }} */ { matchId },
      /** @type {Scope} */ scope,
    ) => void (await closeConversation(scope.stores, matchId, scope.afterCommit)),

    /**
     * `user.blocked.v1`: close the pair's conversation at once (matching's unmatch event may
     * come later; whichever is first notifies).
     * @param {{ blockerId: string, blockedId: string }} payload
     * @param {Scope} scope
     */
    async onUserBlocked({ blockerId, blockedId }, scope) {
      for (const c of await scope.stores.conversations.openForUser(blockerId)) {
        if (c.userLow === blockedId || c.userHigh === blockedId) {
          await closeConversation(scope.stores, c.id, scope.afterCommit);
        }
      }
    },

    /**
     * `user.deleted.v1`: close every conversation of the user (the other person is told
     * `deleted`), then erase the user's messages and read cursors.
     * @param {{ userId: string }} payload
     * @param {Scope} scope
     */
    async onUserDeleted({ userId }, scope) {
      for (const c of await scope.stores.conversations.openForUser(userId)) {
        await closeConversation(scope.stores, c.id, scope.afterCommit);
      }
      await scope.stores.messages.removeBySender(userId);
      await scope.stores.cursors.removeForUser(userId);
    },
  };
}
