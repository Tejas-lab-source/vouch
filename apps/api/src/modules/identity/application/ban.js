// @ts-check

/**
 * Handles `user.banned.v1`: signs the user out everywhere, marks the account banned, and keeps
 * the email HMAC while the ban lasts, so an erased account cannot sign up again (Phase 10).
 * @param {{ clock: { now: () => Date } }} deps
 * @returns {(payload: { userId: string, banId: string, expiresAt: string | null }, stores: import('../ports.js').IdentityStores) => Promise<void>}
 */
export function makeOnUserBanned({ clock }) {
  return async ({ userId, banId, expiresAt }, stores) => {
    await stores.sessions.revokeAllForUser(userId, clock.now());
    const user = /** @type {any} */ (await stores.users.findById(userId));
    if (!user) return;
    await stores.bannedEmails.insert({
      banId,
      emailHmac: user.emailHmac,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
    if (user.status !== 'deleted') await stores.users.setStatus(userId, 'banned');
  };
}

/**
 * Handles `user.unbanned.v1`: a banned account becomes active again (its sessions stay
 * revoked: the user signs in afresh) and the email record goes.
 * @returns {(payload: { userId: string, banId: string }, stores: import('../ports.js').IdentityStores) => Promise<void>}
 */
export function makeOnUserUnbanned() {
  return async ({ userId, banId }, stores) => {
    await stores.bannedEmails.removeByBan(banId);
    const user = await stores.users.findById(userId);
    if (user?.status === 'banned') await stores.users.setStatus(userId, 'active');
  };
}

/**
 * Handles `verification.decided.v1`: an approved ID-card review activates a `pending_review`
 * account. A rejection leaves it `pending_review`, so the student can submit again.
 * @returns {(payload: { userId: string, decision: 'approved' | 'rejected' }, stores: import('../ports.js').IdentityStores) => Promise<void>}
 */
export function makeOnVerificationDecided() {
  return async ({ userId, decision }, stores) => {
    if (decision !== 'approved') return;
    const user = await stores.users.findById(userId);
    if (user?.status === 'pending_review') await stores.users.setStatus(userId, 'active');
  };
}
