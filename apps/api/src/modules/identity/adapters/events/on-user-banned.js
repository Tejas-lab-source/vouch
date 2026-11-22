// @ts-check
import { makeOnUserBanned } from '../../application/ban.js';
import { createIdentityStores } from '../pg/stores.js';

/**
 * Consumer of `user.banned.v1`. Runs in the inbox transaction, as `vouch_identity`.
 * @param {{ clock: { now: () => Date } }} deps
 * @returns {import('../../../../platform/events/consume.js').EventHandler}
 */
export function onUserBanned(deps) {
  const handle = makeOnUserBanned(deps);
  return async (payload, { tx }) => handle(payload, createIdentityStores(tx));
}
