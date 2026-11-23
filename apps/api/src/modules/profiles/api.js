// @ts-check

/**
 * Public in-process API of profiles. Other modules call only this.
 * - `getCards(userIds)`: profile cards (`ProfileCard`) for active profiles, in the order asked;
 *   profiles that cannot be shown are skipped. Cached for 10 minutes.
 * - `getCard(userId)`: one card, or null.
 * - `isActive(userId)`: whether the profile is complete and visible (Phase 8: swipes).
 * - `hide(userId, staff?)`, `unhide(userId, staff?)`: moderation (Phase 10); idempotent, null
 *   without a profile. A staff call passes its audit trail (ADR 0025).
 * - `statusOf(userId)`: `pending`, `active`, `hidden`, or null without a profile (admin view).
 * @param {{ getCards: (ids: readonly string[]) => Promise<unknown[]>, isActive: (userId: string) => Promise<boolean>, hide: (userId: string, staff?: { trail?: import("../../platform/uow.js").AuditTrail, targetId?: string }) => Promise<{ status: string } | null>, unhide: (userId: string, staff?: { trail?: import("../../platform/uow.js").AuditTrail, targetId?: string }) => Promise<{ status: string } | null>, statusOf: (userId: string) => Promise<string | null>, minApprovedPhotos: number }} queries
 */
export function createProfilesApi({
  getCards,
  isActive,
  hide,
  unhide,
  statusOf,
  minApprovedPhotos,
}) {
  return {
    getCards,
    isActive,
    hide,
    unhide,
    statusOf,
    /** Approved photos a profile needs to be shown (client limits, `GET /v1/config`). */
    minApprovedPhotos,
    /** @param {string} userId */
    getCard: async (userId) => (await getCards([userId])).at(0) ?? null,
  };
}
