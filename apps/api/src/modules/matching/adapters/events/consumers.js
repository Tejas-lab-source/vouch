// @ts-check
import { createMatchingStores } from '../pg/stores.js';

/**
 * Event handlers for matching's consumers (inbox transaction as `vouch_matching`).
 * @param {ReturnType<typeof import('../../application/consumers.js').makeMatchingConsumers>} consumers
 * @returns {Map<string, import('../../../../platform/events/consume.js').EventHandler>}
 */
export function matchingEventHandlers(consumers) {
  /** @param {import('../../../../platform/events/consume.js').EventContext} context */
  const scopeOf = ({ tx, emit }) => ({ stores: createMatchingStores(tx), emit });
  return new Map([
    ['user.blocked.v1', (payload, context) => consumers.onUserBlocked(payload, scopeOf(context))],
    ['user.deleted.v1', (payload, context) => consumers.onUserDeleted(payload, scopeOf(context))],
  ]);
}
