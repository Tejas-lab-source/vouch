// @ts-check
import {
  makeOnUserBanned,
  makeOnUserUnbanned,
  makeOnVerificationDecided,
} from '../../application/ban.js';
import { createIdentityStores } from '../pg/stores.js';

/**
 * Consumer of `user.banned.v1`. Runs in the inbox transaction, as `vouch_identity`.
 * @param {{ clock: { now: () => Date } }} deps
 * @returns {import('../../../../platform/events/consume.js').EventHandler}
 */
export function onUserBanned(deps) {
  const handle = makeOnUserBanned(deps);
  return async (payload, { tx }) => handle(/** @type {any} */ (payload), createIdentityStores(tx));
}

/** Consumer of `user.unbanned.v1`. @returns {import('../../../../platform/events/consume.js').EventHandler} */
export function onUserUnbanned() {
  const handle = makeOnUserUnbanned();
  return async (payload, { tx }) => handle(/** @type {any} */ (payload), createIdentityStores(tx));
}

/** Consumer of `verification.decided.v1`. @returns {import('../../../../platform/events/consume.js').EventHandler} */
export function onVerificationDecided() {
  const handle = makeOnVerificationDecided();
  return async (payload, { tx }) => handle(/** @type {any} */ (payload), createIdentityStores(tx));
}
