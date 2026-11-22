// @ts-check

/**
 * Handles `user.banned.v1`: signs the user out everywhere and marks the account banned.
 * Lifting a ban (and restoring the status) is Phase 10's, with an additive event.
 * @param {{ clock: { now: () => Date } }} deps
 * @returns {(payload: { userId: string }, stores: import('../ports.js').IdentityStores) => Promise<void>}
 */
export function makeOnUserBanned({ clock }) {
  return async ({ userId }, stores) => {
    await stores.sessions.revokeAllForUser(userId, clock.now());
    const user = await stores.users.findById(userId);
    if (user && user.status !== 'deleted') await stores.users.setStatus(userId, 'banned');
  };
}
