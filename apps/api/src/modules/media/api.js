// @ts-check
import { makeRelease } from './application/release.js';

/**
 * Public in-process API of media. Other modules call only this.
 * - `deleteObjects(keys)`: deletes stored objects under `photos/` or `uploads/` (idempotent).
 * - `releaseUpload(uploadId, userId)`: forgets one upload (a photo the user deleted) and deletes
 *   all its objects, including a result still being processed (idempotent).
 * - `photoUrl(key)`: the public CDN URL of a variant key.
 * @param {Pick<import('./ports.js').MediaDeps, 'uow' | 'storage' | 'settings'>} deps
 */
export function createMediaApi(deps) {
  const { deleteObjects, releaseUpload } = makeRelease(deps);
  const base = deps.settings.cdnBaseUrl.replace(/\/+$/, '');
  return {
    deleteObjects,
    releaseUpload,
    /** @param {string} key */
    photoUrl: (key) => `${base}/${key}`,
  };
}

/** @typedef {ReturnType<typeof createMediaApi>} MediaApi */
