// @ts-check
import { createChatStores } from '../pg/stores.js';

/**
 * @param {ReturnType<typeof import('../../application/consumers.js').makeChatConsumers>} consumers
 * @returns {Map<string, import('../../../../platform/events/consume.js').EventHandler>}
 */
export function chatEventHandlers(consumers) {
  /** @param {import('../../../../platform/events/consume.js').EventContext} c */
  const scopeOf = ({ tx, afterCommit }) => ({ stores: createChatStores(tx), afterCommit });
  return new Map([
    ['match.created.v1', (p, c) => consumers.onMatchCreated(p, scopeOf(c))],
    ['match.unmatched.v1', (p, c) => consumers.onMatchUnmatched(p, scopeOf(c))],
    ['user.blocked.v1', (p, c) => consumers.onUserBlocked(p, scopeOf(c))],
    ['user.deleted.v1', (p, c) => consumers.onUserDeleted(p, scopeOf(c))],
  ]);
}
