// @ts-check

/** Profile changes that can change who someone should see. */
const ELIGIBILITY_FIELDS = new Set(['gender', 'interestedIn', 'ageRange', 'status', 'photos']);

/**
 * Event consumers. Decks are disposable Redis state, so these only edit or rebuild decks.
 * @param {Pick<import('../ports.js').DiscoveryDeps, 'decks' | 'builds'>} deps
 */
export function makeDiscoveryConsumers({ decks, builds }) {
  /** @param {string} a @param {string} b */
  const removePair = async (a, b) => {
    await Promise.all([decks.remove(a, b), decks.remove(b, a)]);
  };
  return {
    /** `user.blocked.v1`: neither sees the other again (read time re-checks too). */
    onUserBlocked: async (/** @type {{ blockerId: string, blockedId: string }} */ p) =>
      removePair(p.blockerId, p.blockedId),
    /** `match.created.v1` (Phase 8): matched people leave each other's decks. */
    onMatchCreated: async (/** @type {{ userLow: string, userHigh: string }} */ p) =>
      removePair(p.userLow, p.userHigh),
    /**
     * `profile.updated.v1`: a change to who the user is or wants rebuilds their own deck; a
     * profile that stops being active loses its deck. Other people's decks drop the user at
     * read time (cards are only hydrated for active profiles).
     * @param {{ userId: string, status: string, changed: string[] }} p
     */
    onProfileUpdated: async (p) => {
      if (p.status !== 'active') return decks.drop(p.userId);
      if (p.changed.some((field) => ELIGIBILITY_FIELDS.has(field))) {
        await builds.enqueueBuild(p.userId, 'eligibility_changed');
      }
      return undefined;
    },
    /** `photo.approved.v1`: the user may have just become showable; rebuild (deduplicated). */
    onPhotoApproved: async (/** @type {{ userId: string }} */ p) =>
      builds.enqueueBuild(p.userId, 'eligibility_changed'),
  };
}
