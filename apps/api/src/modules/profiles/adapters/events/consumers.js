// @ts-check
import { createProfilesStores } from '../pg/stores.js';

/**
 * Adapts the profile consumers to event handlers: each runs in the inbox transaction, as
 * `vouch_profiles`, with outbox emit and after-commit hooks from the platform.
 * @param {ReturnType<typeof import('../../application/events.js').makeProfileConsumers>} consumers
 * @returns {Record<string, import('../../../../platform/events/consume.js').EventHandler>}
 */
export function profileEventHandlers(consumers) {
  /** @param {import('../../../../platform/events/consume.js').EventContext} context */
  const scopeOf = ({ tx, emit, afterCommit }) => ({
    stores: createProfilesStores(tx),
    emit,
    afterCommit,
  });
  return {
    'user.created.v1': (payload, context) => consumers.onUserCreated(payload, scopeOf(context)),
    'user.deleted.v1': (payload, context) => consumers.onUserDeleted(payload, scopeOf(context)),
    'photo.uploaded.v1': (payload, context) => consumers.onPhotoUploaded(payload, scopeOf(context)),
    'photo.approved.v1': (payload, context) =>
      consumers.onPhotoResult(payload, 'approved', scopeOf(context)),
    'photo.rejected.v1': (payload, context) =>
      consumers.onPhotoResult(payload, 'rejected', scopeOf(context)),
  };
}
