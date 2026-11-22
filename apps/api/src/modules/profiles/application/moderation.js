// @ts-check
import { missingRequirements } from '../domain/profile.js';
import { applyChange } from './changes.js';

/**
 * Moderation of profiles (Phase 10): safety hides a reported profile and staff unhide it.
 * `hidden` keeps the profile out of decks, matches and chats' cards; unhiding returns it to
 * `active` when complete, else `pending`. Both are idempotent and emit `profile.updated.v1`
 * only when the status changes.
 * @param {Pick<import('../ports.js').ProfilesDeps, 'uow' | 'cards' | 'clock'>} deps
 */
export function makeProfileModeration({ uow, cards, clock }) {
  /**
   * @param {string} userId
   * @param {boolean} hidden
   * @returns {Promise<{ status: string } | null>} null when the user has no profile
   */
  async function setHidden(userId, hidden) {
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
      return { status: next.status };
    });
    if (result) await cards.invalidate(userId);
    return result;
  }

  return {
    /** @param {string} userId */
    hide: (userId) => setHidden(userId, true),
    /** @param {string} userId */
    unhide: (userId) => setHidden(userId, false),
  };
}
