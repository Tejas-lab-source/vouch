// @ts-check
import { makeUserQueries } from './application/users.js';

/**
 * Public in-process API of identity. Other modules call only this.
 * - `getUser(id)`: `{ id, publicId, collegeId, status, birthDate }` or null.
 * - `getUsersByIds(ids)`: the same view for many users.
 * - `getUsersByPublicIds(publicIds)`: the same view, looked up by public id (Phase 7).
 * - `assertActive(id)`: throws FORBIDDEN unless the account is active
 *   (`ACCOUNT_PENDING_REVIEW` while an ID-card review is pending).
 * - `pushTokensOf(userId)`: push tokens of the user's signed-in devices (Phase 10).
 * - `removePushToken(token)`: forgets a token the push provider reported invalid.
 * @param {Pick<import('./ports.js').IdentityDeps, 'read' | 'uow'>} deps
 */
export function createIdentityApi(deps) {
  return {
    ...makeUserQueries(deps),
    /** @param {string} userId */
    pushTokensOf: (userId) => deps.read((stores) => stores.devices.pushTokensOf(userId)),
    /** @param {string} token */
    removePushToken: (token) =>
      deps.uow.run(async ({ stores }) => stores.devices.clearPushToken(token)),
  };
}
