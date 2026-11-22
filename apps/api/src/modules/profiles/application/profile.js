// @ts-check
import { ServiceError } from '@vouch/contracts';
import { mergeAgeRange } from '../domain/profile.js';
import { applyChange } from './changes.js';
import { ownProfileView } from './views.js';

/** @param {Date | string} value */
const isoDate = (value) =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/**
 * The profile use cases behind `/v1/me/profile` and `/v1/me/photos`, plus `createEmptyProfile`.
 * @param {import('../ports.js').ProfilesDeps} deps
 */
export function makeProfileUseCases(deps) {
  const { useCase, uow, read, identity, media, cards, sections: registry, clock } = deps;

  /**
   * Creates the empty profile if it does not exist yet (idempotent). Used by the
   * `user.created.v1` consumer, and by the first read in case that event is still in flight.
   * @param {import('../ports.js').ProfilesStores} stores
   * @param {{ userId: string, collegeId: string, clusterId: string, birthDate: string }} user
   */
  const createEmptyProfile = (stores, user) =>
    stores.profiles.insertIfMissing({ ...user, at: clock.now() });

  /**
   * The profile of an existing user, creating it from identity if needed.
   * @param {string} userId
   */
  async function ensureProfile(userId) {
    const existing = await read((stores) => stores.profiles.find(userId));
    if (existing) return;
    const user = await identity.getUser(userId);
    if (!user) throw new ServiceError('NOT_FOUND');
    await uow.run(async ({ stores }) => {
      const [college] = await stores.colleges.byIds([user.collegeId]);
      if (!college) throw new Error(`college ${user.collegeId} is not active`);
      await createEmptyProfile(stores, {
        userId,
        collegeId: user.collegeId,
        clusterId: college.clusterId,
        birthDate: isoDate(user.birthDate),
      });
    });
  }

  /** @param {string} userId */
  async function ownView(userId) {
    const user = await identity.getUser(userId);
    const data = await read(async (stores) => ({
      profile: await stores.profiles.find(userId),
      photos: await stores.photos.listForUser(userId),
      sections: await stores.sections.listForUser(userId),
    }));
    if (!user || !data.profile) throw new ServiceError('NOT_FOUND');
    return ownProfileView({
      profile: data.profile,
      publicId: user.publicId,
      photos: data.photos,
      sections: data.sections,
      url: media.photoUrl,
      now: clock.now(),
    });
  }

  /**
   * Locks the caller's profile, applies `edit`, and saves through `applyChange`.
   * @param {string} userId
   * @param {(profile: import('../ports.js').ProfileRecord, scope: import('../../../platform/uow.js').UnitOfWorkScope<import('../ports.js').ProfilesStores>) => Promise<{ profile: import('../ports.js').ProfileRecord, changed: import('./changes.js').ChangedField[] } | null>} edit
   *   Returns null when nothing changed.
   */
  async function change(userId, edit) {
    await ensureProfile(userId);
    const changed = await uow.run(async (scope) => {
      const profile = await scope.stores.profiles.findForUpdate(userId);
      if (!profile) throw new ServiceError('NOT_FOUND');
      const result = await edit(profile, scope);
      if (!result) return false;
      await applyChange(scope, result.profile, result.changed, clock.now());
      return true;
    });
    if (changed) await cards.invalidate(userId);
  }

  const getMyProfile = useCase(
    'profiles.getMyProfile',
    async (/** @type {unknown} */ _input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      await ensureProfile(userId);
      return ownView(userId);
    },
  );

  const updateMyProfile = useCase(
    'profiles.updateMyProfile',
    /** @param {{ name?: string, gender?: number, interestedIn?: number[], bio?: string | null, minAge?: number, maxAge?: number }} input */
    async (input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      await change(userId, async (profile) => {
        const range = mergeAgeRange(profile, input);
        if (!range) {
          throw new ServiceError('VALIDATION_FAILED', {
            message: 'minAge must not exceed maxAge.',
          });
        }
        /** @type {import('./changes.js').ChangedField[]} */
        const changed = [];
        if (input.name !== undefined) changed.push('name');
        if (input.gender !== undefined) changed.push('gender');
        if (input.interestedIn !== undefined) changed.push('interestedIn');
        if (input.bio !== undefined) changed.push('bio');
        if (input.minAge !== undefined || input.maxAge !== undefined) changed.push('ageRange');
        return {
          profile: {
            ...profile,
            name: input.name ?? profile.name,
            gender: input.gender ?? profile.gender,
            interestedIn: input.interestedIn ?? profile.interestedIn,
            bio: input.bio === undefined ? profile.bio : input.bio,
            ...range,
          },
          changed,
        };
      });
      return ownView(userId);
    },
  );

  const putSection = useCase(
    'profiles.putSection',
    /** @param {{ type: string, schemaVersion: number, position: number, data: unknown }} input */
    async (input, ctx) => {
      const definition = registry.get(input.type);
      if (!definition) throw new ServiceError('UNKNOWN_SECTION_TYPE');
      if (input.schemaVersion !== definition.schemaVersion) {
        throw new ServiceError('VALIDATION_FAILED', {
          message: `Section ${input.type} expects schemaVersion ${definition.schemaVersion}.`,
        });
      }
      const parsed = definition.data.safeParse(input.data);
      if (!parsed.success) {
        throw new ServiceError('VALIDATION_FAILED', {
          details: {
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
        });
      }
      const userId = /** @type {string} */ (ctx.actor?.userId);
      const entry = {
        userId,
        type: input.type,
        schemaVersion: input.schemaVersion,
        data: parsed.data,
        position: input.position,
      };
      await change(userId, async (profile, { stores }) => {
        await stores.sections.upsert({ ...entry, at: clock.now() });
        return { profile, changed: ['sections'] };
      });
      return {
        type: entry.type,
        schemaVersion: entry.schemaVersion,
        position: entry.position,
        data: entry.data,
      };
    },
  );

  const deleteMyPhoto = useCase(
    'profiles.deleteMyPhoto',
    /** @param {{ id: string }} input */
    async (input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      let owned = false;
      await change(userId, async (profile, { stores }) => {
        const photo = await stores.photos.findForUpdate(input.id);
        if (!photo || photo.userId !== userId) return null;
        owned = true;
        if (photo.status === 'deleted') return null;
        await stores.photos.setStatus(photo.id, 'deleted', null, clock.now());
        return { profile, changed: ['photos'] };
      });
      // After commit: delete the files (including a result still being processed). Retrying
      // the request repeats this, so a failure here is never permanent.
      if (owned) await media.releaseUpload(input.id, userId);
      return ownView(userId);
    },
  );

  return {
    createEmptyProfile,
    ensureProfile,
    getMyProfile,
    updateMyProfile,
    putSection,
    deleteMyPhoto,
  };
}
