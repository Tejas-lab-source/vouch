// @ts-check

/**
 * Public in-process API of profiles. Other modules call only this.
 * - `getCards(userIds)`: profile cards (`ProfileCard`) for active profiles, in the order asked;
 *   profiles that cannot be shown are skipped. Cached for 10 minutes.
 * - `getCard(userId)`: one card, or null.
 * @param {{ getCards: (ids: readonly string[]) => Promise<unknown[]> }} queries
 */
export function createProfilesApi({ getCards }) {
  return {
    getCards,
    /** @param {string} userId */
    getCard: async (userId) => (await getCards([userId])).at(0) ?? null,
  };
}
