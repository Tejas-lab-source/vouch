// @ts-check
import { ServiceError } from '@vouch/contracts';
import { DELETABLE_PREFIXES, objectsOf } from '../domain/upload.js';

/**
 * Removing media: a photo the user deleted, raw object keys given by profiles, and everything
 * of a deleted account. All of it is idempotent.
 * @param {Pick<import('../ports.js').MediaDeps, 'uow' | 'storage'>} deps
 */
export function makeRelease({ uow, storage }) {
  /**
   * Deletes stored objects by key. Only keys under `photos/` and `uploads/` are accepted.
   * @param {readonly string[]} objectKeys
   */
  async function deleteObjects(objectKeys) {
    const invalid = objectKeys.filter((k) => !DELETABLE_PREFIXES.some((p) => k.startsWith(p)));
    if (invalid.length > 0) throw new ServiceError('VALIDATION_FAILED');
    if (objectKeys.length > 0) await storage.remove(objectKeys);
  }

  /**
   * Forgets one upload of this user and deletes all its objects. A worker still processing it
   * finds the row gone and discards its output.
   * @param {string} uploadId
   * @param {string} userId
   */
  async function releaseUpload(uploadId, userId) {
    const upload = await uow.run(async ({ stores }) => {
      const found = await stores.uploads.findForUpdate(uploadId);
      if (!found || found.userId !== userId) return null;
      await stores.uploads.remove(found.id);
      return found;
    });
    if (upload) await storage.remove(objectsOf(upload));
    return { released: upload !== null };
  }

  /**
   * Consumer of `user.deleted.v1`: deletes every object and upload row of the user, in the
   * consumer's transaction (objects first, so a failed run retries both).
   * @param {{ userId: string }} payload
   * @param {import('../ports.js').MediaStores} stores
   */
  async function eraseUser({ userId }, stores) {
    const uploads = await stores.uploads.listForUser(userId);
    const objects = uploads.flatMap((upload) => objectsOf(upload));
    if (objects.length > 0) await storage.remove(objects);
    await stores.uploads.removeForUser(userId);
  }

  return { deleteObjects, releaseUpload, eraseUser };
}
