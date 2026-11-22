// @ts-check
import { makeUserQueries } from './application/users.js';

/**
 * Public in-process API of identity. Other modules call only this.
 * - `getUser(id)`: `{ id, publicId, collegeId, status, birthDate }` or null.
 * - `getUsersByIds(ids)`: the same view for many users.
 * - `getUsersByPublicIds(publicIds)`: the same view, looked up by public id (Phase 7).
 * - `assertActive(id)`: throws FORBIDDEN unless the account is active.
 * @param {Pick<import('./ports.js').IdentityDeps, 'read'>} deps
 */
export function createIdentityApi(deps) {
  return makeUserQueries(deps);
}
