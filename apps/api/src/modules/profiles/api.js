// @ts-check

/**
 * Public in-process API of profiles. Other modules call only this.
 * - `getCards(userIds)`: profile cards (`ProfileCard`) for active profiles, in the order asked;
 *   profiles that cannot be shown are skipped. Cached for 10 minutes.
 * - `getCard(userId)`: one card, or null.
 * - `isActive(userId)`: whether the profile is complete and visible (Phase 8: swipes).
 * - `hide(userId)`, `unhide(userId)`: moderation (Phase 10); idempotent, null without a profile.
 * @param {{ getCards: (ids: readonly string[]) => Promise<unknown[]>, isActive: (userId: string) => Promise<boolean>, hide: (userId: string) => Promise<{ status: string } | null>, unhide: (userId: string) => Promise<{ status: string } | null> }} queries
 */
export function createProfilesApi({ getCards, isActive, hide, unhide }) {
  return {
    getCards,
    isActive,
    hide,
    unhide,
    /** @param {string} userId */
    getCard: async (userId) => (await getCards([userId])).at(0) ?? null,
  };
}
