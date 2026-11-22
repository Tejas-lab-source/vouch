// @ts-check

/**
 * Public in-process API of profiles. Other modules call only this.
 * - `getCards(userIds)`: profile cards (`ProfileCard`) for active profiles, in the order asked;
 *   profiles that cannot be shown are skipped. Cached for 10 minutes.
 * - `getCard(userId)`: one card, or null.
 * - `isActive(userId)`: whether the profile is complete and visible (Phase 8: swipes).
 * @param {{ getCards: (ids: readonly string[]) => Promise<unknown[]>, isActive: (userId: string) => Promise<boolean> }} queries
 */
export function createProfilesApi({ getCards, isActive }) {
  return {
    getCards,
    isActive,
    /** @param {string} userId */
    getCard: async (userId) => (await getCards([userId])).at(0) ?? null,
  };
}
