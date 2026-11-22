// @ts-check
import { createMediaStores } from '../pg/stores.js';

/**
 * Consumer of `photo.uploaded.v1`: queues the image job. The job id is derived from the
 * upload, so a redelivered event does not queue a second job.
 * @param {{ jobs: import('../../../../platform/jobs.js').JobRunner }} deps
 * @returns {import('../../../../platform/events/consume.js').EventHandler}
 */
export function onPhotoUploaded({ jobs }) {
  return async (payload) => {
    await jobs.add(
      'media.processImage',
      { uploadId: payload.uploadId, userId: payload.userId },
      { jobId: `process-${payload.uploadId}` },
    );
  };
}

/**
 * Consumer of `user.deleted.v1`: erases the user's uploads and stored objects.
 * @param {{ eraseUser: ReturnType<typeof import('../../application/release.js').makeRelease>['eraseUser'] }} deps
 * @returns {import('../../../../platform/events/consume.js').EventHandler}
 */
export function onUserDeleted({ eraseUser }) {
  return async (payload, { tx }) => eraseUser(payload, createMediaStores(tx));
}
