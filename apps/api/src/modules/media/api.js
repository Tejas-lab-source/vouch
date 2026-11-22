// @ts-check
import { makeProcessing } from './application/process.js';
import { makeRelease } from './application/release.js';

/**
 * Public in-process API of media. Other modules call only this.
 * - `deleteObjects(keys)`: deletes stored objects under `photos/` or `uploads/` (idempotent).
 * - `releaseUpload(uploadId, userId)`: forgets one upload (a photo the user deleted) and deletes
 *   all its objects, including a result still being processed (idempotent).
 * - `photoUrl(key)`: the public CDN URL of a variant key.
 * - `resolveReview(uploadId, 'approve' | 'reject')`: the moderation queue's decision on a photo
 *   held for review (Phase 10 calls it). Idempotent.
 * @param {import('./ports.js').MediaDeps} deps
 */
export function createMediaApi(deps) {
  const { deleteObjects, releaseUpload } = makeRelease(deps);
  const { resolveReview } = makeProcessing(deps);
  const base = deps.settings.cdnBaseUrl.replace(/\/+$/, '');
  return {
    deleteObjects,
    releaseUpload,
    resolveReview,
    /** @param {string} key */
    photoUrl: (key) => `${base}/${key}`,
  };
}

/** @typedef {ReturnType<typeof createMediaApi>} MediaApi */
