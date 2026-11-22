// @ts-check
import { makeProcessing } from './application/process.js';
import { makeRelease } from './application/release.js';
import { makeReview } from './application/review.js';

/**
 * Public in-process API of media. Other modules call only this.
 * - `deleteObjects(keys)`: deletes stored objects under `photos/` or `uploads/` (idempotent).
 * - `releaseUpload(uploadId, userId)`: forgets one upload (a photo the user deleted) and deletes
 *   all its objects, including a result still being processed (idempotent).
 * - `photoUrl(key)`: the public CDN URL of a variant key.
 * - `resolveReview(uploadId, 'approve' | 'reject')`: the moderation queue's decision on a photo
 *   held for review (Phase 10 calls it). Idempotent.
 * - `listInReview({ afterId, limit })`: photos waiting for review, with 5-minute signed URLs.
 * - `privateObjects`: presigned upload, existence check, signed read and delete for private
 *   `verification/` objects (ID-card images, Phase 10).
 * @param {import('./ports.js').MediaDeps} deps
 */
export function createMediaApi(deps) {
  const { deleteObjects, releaseUpload } = makeRelease(deps);
  const { resolveReview } = makeProcessing(deps);
  const base = deps.settings.cdnBaseUrl.replace(/\/+$/, '');
  const { listInReview, privateObjects } = makeReview(deps);
  return {
    listInReview,
    privateObjects,
    deleteObjects,
    releaseUpload,
    resolveReview,
    /** @param {string} key */
    photoUrl: (key) => `${base}/${key}`,
  };
}

/** @typedef {ReturnType<typeof createMediaApi>} MediaApi */
