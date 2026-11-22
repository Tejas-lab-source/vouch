// @ts-check
import { cardView, ownProfileView } from './views.js';

/** The pipeline profiles owns: other modules add card fields without editing profiles. */
export const CARD_FIELDS_PIPELINE = 'profiles.cardFields';

/**
 * `api.getCards(ids)`: profile cards for active profiles, in the order asked, skipping any that
 * cannot be shown. Cards are cached in Redis for 10 minutes (`profiles:card:{userId}`) and
 * invalidated on every change; the `profiles.cardFields` chain runs on every read, after the
 * cache, so contributed fields are never stale.
 * @param {import('../ports.js').ProfilesDeps} deps
 */
export function makeCardQueries({ read, identity, media, cards, pipelines, clock }) {
  /** @param {readonly string[]} userIds */
  async function build(userIds) {
    if (userIds.length === 0) return new Map();
    const [data, users] = await Promise.all([
      read(async (stores) => {
        const profiles = await stores.profiles.findActiveMany(userIds);
        const ids = profiles.map((p) => p.userId);
        return {
          profiles,
          photos: await stores.photos.approvedForUsers(ids),
          sections: await stores.sections.listForUsers(ids),
          colleges: await stores.colleges.byIds([...new Set(profiles.map((p) => p.collegeId))]),
        };
      }),
      identity.getUsersByIds(userIds),
    ]);
    const publicIds = new Map(users.map((u) => [u.id, u.publicId]));
    const collegeNames = new Map(data.colleges.map((c) => [c.id, c.name]));
    const now = clock.now();
    /** @type {Map<string, unknown>} */
    const built = new Map();
    for (const profile of data.profiles) {
      const publicId = publicIds.get(profile.userId);
      const collegeName = collegeNames.get(profile.collegeId);
      if (!publicId || !collegeName) continue;
      const card = cardView({
        profile,
        publicId,
        collegeName,
        photos: data.photos.filter((p) => p.userId === profile.userId),
        sections: data.sections.filter((s) => s.userId === profile.userId),
        url: media.photoUrl,
        now,
      });
      if (card) built.set(profile.userId, card);
    }
    return built;
  }

  /** @param {readonly string[]} userIds */
  async function getCards(userIds) {
    const unique = [...new Set(userIds)];
    const cached = await cards.getMany(unique);
    const misses = unique.filter((id) => !cached.has(id));
    const built = await build(misses);
    await cards.setMany([...built].map(([userId, card]) => ({ userId, card })));
    const result = [];
    for (const id of userIds) {
      const card = cached.get(id) ?? built.get(id);
      if (card) result.push(await pipelines.run(CARD_FIELDS_PIPELINE, card));
    }
    return result;
  }

  /**
   * Personal data for the export (`GET /v1/me/export`).
   * @param {string} userId
   */
  async function exportFor(userId) {
    const [user, data] = await Promise.all([
      identity.getUser(userId),
      read(async (stores) => ({
        profile: await stores.profiles.find(userId),
        photos: await stores.photos.listForUser(userId),
        sections: await stores.sections.listForUser(userId),
      })),
    ]);
    if (!user || !data.profile) return { profile: null };
    const view = ownProfileView({
      profile: data.profile,
      publicId: user.publicId,
      photos: data.photos,
      sections: data.sections,
      url: media.photoUrl,
      now: clock.now(),
    });
    return { profile: { ...view, birthDate: data.profile.birthDate } };
  }

  return { getCards, exportFor };
}
