// @ts-check
import { recordAudit } from '../../../platform/uow.js';
import { MIN_APPROVED_PHOTOS, missingRequirements } from '../domain/profile.js';
import { applyChange } from './changes.js';

/**
 * Moderation of profiles (Phase 10): safety hides a reported profile and staff unhide it.
 * `hidden` keeps the profile out of decks, matches and chats' cards; unhiding returns it to
 * `active` when complete, else `pending`. Both are idempotent and emit `profile.updated.v1`
 * only when the status changes.
 * @param {Pick<import('../ports.js').ProfilesDeps, 'uow' | 'read' | 'cards' | 'clock'>} deps
 */
export function makeProfileModeration({ uow, read, cards, clock }) {
  /**
   * @param {string} userId
   * @param {boolean} hidden
   * @param {import('../../../platform/uow.js').AuditTrail | null} [trail]
   * @param {string} [targetId]  The id shown in the audit log (the public id).
   * @returns {Promise<{ status: string } | null>} null when the user has no profile
   */
  async function setHidden(userId, hidden, trail = null, targetId = userId) {
    const result = await uow.run(async ({ stores, emit }) => {
      const profile = await stores.profiles.findForUpdate(userId);
      if (!profile) return null;
      if (hidden === (profile.status === 'hidden')) return { status: profile.status };
      if (hidden) {
        const next = await applyChange(
          { stores, emit },
          { ...profile, status: 'hidden' },
          ['status'],
          clock.now(),
        );
        await recordAudit(emit, trail, { action: 'profile.hide', targetType: 'user', targetId });
        return { status: next.status };
      }
      const photos = await stores.photos.listForUser(userId);
      const approved = photos.filter((p) => p.status === 'approved').length;
      const status = missingRequirements(profile, approved).length === 0 ? 'active' : 'pending';
      const next = await applyChange(
        { stores, emit },
        { ...profile, status },
        ['status'],
        clock.now(),
      );
      await recordAudit(emit, trail, { action: 'profile.unhide', targetType: 'user', targetId });
      return { status: next.status };
    });
    if (result) await cards.invalidate(userId);
    return result;
  }

  return {
    /**
     * @param {string} userId
     * @param {{ trail?: import('../../../platform/uow.js').AuditTrail, targetId?: string }} [staff]
     *   A staff action: audited in the same transaction (ADR 0025), with `targetId` the public id.
     */
    hide: (userId, staff = {}) => setHidden(userId, true, staff.trail ?? null, staff.targetId),
    /**
     * @param {string} userId
     * @param {{ trail?: import('../../../platform/uow.js').AuditTrail, targetId?: string }} [staff]
     */
    unhide: (userId, staff = {}) => setHidden(userId, false, staff.trail ?? null, staff.targetId),
    minApprovedPhotos: MIN_APPROVED_PHOTOS,
    /** @param {string} userId */
    statusOf: async (userId) =>
      (await read((stores) => stores.profiles.find(userId)))?.status ?? null,
  };
}
