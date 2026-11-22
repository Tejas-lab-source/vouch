// @ts-check
import { nextPhotoPosition } from '../domain/profile.js';
import { applyChange } from './changes.js';

/**
 * Consumers of identity and media events. Each runs in the consumer's inbox transaction, so a
 * redelivered event is skipped by the inbox, and every handler is also idempotent by itself.
 * @param {import('../ports.js').ProfilesDeps & { createEmptyProfile: ReturnType<typeof import('./profile.js').makeProfileUseCases>['createEmptyProfile'] }} deps
 */
export function makeProfileConsumers(deps) {
  const { media, cards, clock, photosMax, createEmptyProfile, identity } = deps;

  /**
   * @typedef {import('./changes.js').ChangeScope & { afterCommit: (fn: () => unknown) => void }} Scope
   */

  /**
   * The locked profile of a photo event's user. Null when the account is gone (deleted): the
   * event is then skipped. A profile missing for a live account means user.created.v1 is still
   * queued, so the event fails and is retried with backoff.
   * @param {Scope} scope
   * @param {string} userId
   */
  async function lockedProfile(scope, userId) {
    const profile = await scope.stores.profiles.findForUpdate(userId);
    if (profile) return profile;
    const user = await identity.getUser(userId);
    if (!user || user.status === 'deleted') return null;
    throw new Error('profile not created yet');
  }

  return {
    /**
     * `user.created.v1`: create exactly one empty profile.
     * @param {{ userId: string, collegeId: string, clusterId: string, birthDate: string }} payload
     * @param {Scope} scope
     */
    async onUserCreated(payload, { stores }) {
      await createEmptyProfile(stores, payload);
    },

    /**
     * `photo.uploaded.v1`: show the photo as pending straight away.
     * @param {{ uploadId: string, userId: string }} payload
     * @param {Scope} scope
     */
    async onPhotoUploaded(payload, scope) {
      const profile = await lockedProfile(scope, payload.userId);
      if (!profile) return;
      const photos = await scope.stores.photos.listForUser(payload.userId);
      if (photos.some((p) => p.id === payload.uploadId)) return;
      const position = nextPhotoPosition(photos, photosMax);
      if (position === null) throw new Error(`no free photo position for ${payload.uploadId}`);
      await scope.stores.photos.insert({
        id: payload.uploadId,
        userId: payload.userId,
        status: 'pending',
        position,
        key1080: null,
        key400: null,
        at: clock.now(),
      });
      await applyChange(scope, profile, ['photos'], clock.now());
      scope.afterCommit(() => cards.invalidate(payload.userId));
    },

    /**
     * `photo.approved.v1` and `photo.rejected.v1`. A photo the owner already deleted stays
     * deleted, and its late result is discarded.
     * @param {{ photoId: string | null, uploadId: string, userId: string, keys?: import('../ports.js').PhotoKeys }} payload
     * @param {'approved' | 'rejected'} status
     * @param {Scope} scope
     */
    async onPhotoResult(payload, status, scope) {
      const photoId = payload.photoId ?? payload.uploadId;
      const profile = await lockedProfile(scope, payload.userId);
      if (!profile) return;
      const photo = await scope.stores.photos.findForUpdate(photoId);
      if (photo?.status === 'deleted') {
        await media.releaseUpload(payload.uploadId, payload.userId);
        return;
      }
      const keys = status === 'approved' ? (payload.keys ?? null) : null;
      if (photo) {
        await scope.stores.photos.setStatus(photoId, status, keys, clock.now());
      } else {
        const photos = await scope.stores.photos.listForUser(payload.userId);
        await scope.stores.photos.insert({
          id: photoId,
          userId: payload.userId,
          status,
          position: nextPhotoPosition(photos, photosMax) ?? photosMax - 1,
          key1080: keys?.w1080 ?? null,
          key400: keys?.w400 ?? null,
          at: clock.now(),
        });
      }
      await applyChange(scope, profile, ['photos'], clock.now());
      scope.afterCommit(() => cards.invalidate(payload.userId));
    },

    /**
     * `user.deleted.v1`: delete the photo files, then the profile (photos and sections
     * cascade). Running twice is harmless.
     * @param {{ userId: string }} payload
     * @param {Scope} scope
     */
    async onUserDeleted({ userId }, scope) {
      const photos = await scope.stores.photos.listForUser(userId);
      const objectKeys = photos.flatMap((p) => [p.key1080, p.key400]).filter((k) => k !== null);
      if (objectKeys.length > 0) await media.deleteObjects(objectKeys);
      await scope.stores.profiles.remove(userId);
      scope.afterCommit(() => cards.invalidate(userId));
    },
  };
}
