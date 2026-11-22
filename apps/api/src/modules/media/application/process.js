// @ts-check
import { photoApproved, photoRejected } from '@vouch/contracts';
import { ImageRejected } from '../domain/errors.js';
import {
  keys,
  objectsOf,
  PHOTO_CACHE_CONTROL,
  sniffImageType,
  VARIANT_NAMES,
} from '../domain/upload.js';

/**
 * @param {import('../ports.js').ProcessedImage} processed
 * @param {import('../domain/upload.js').VariantName} variant
 */
const bytesOf = (processed, variant) => {
  const found = processed.variants.get(variant);
  if (!found) throw new Error(`variant ${variant} missing`);
  return found.data;
};

/**
 * The image worker's use cases (job `media.processImage`). Safe to retry at every step:
 * a finished upload is skipped, the photo key is chosen once and reused, and an upload that
 * was released (the user deleted the photo) while processing has its objects removed.
 * @param {import('../ports.js').MediaDeps} deps
 */
export function makeProcessing(deps) {
  const { uow, storage, images, contentCheck, clock, randomKey, logger } = deps;

  /**
   * Records the outcome in one transaction, unless the upload is gone or already finished.
   * @param {string} uploadId
   * @param {(scope: import('../../../platform/uow.js').UnitOfWorkScope<import('../ports.js').MediaStores>, upload: import('../ports.js').UploadRecord) => Promise<void>} apply
   * @returns {Promise<'recorded' | 'released' | 'finished'>}
   */
  const finish = (uploadId, apply) =>
    uow.run(async (scope) => {
      const upload = await scope.stores.uploads.findForUpdate(uploadId);
      if (!upload) return 'released';
      if (upload.status !== 'processing') return 'finished';
      await apply(scope, upload);
      return 'recorded';
    });

  /**
   * @param {string} uploadId
   * @param {import('../domain/errors.js').RejectionReason} reason
   */
  async function reject(uploadId, reason) {
    const at = clock.now();
    const outcome = await finish(uploadId, async ({ stores, emit }, upload) => {
      await stores.uploads.markRejected(upload.id, reason, at);
      await emit(photoRejected, {
        photoId: upload.id,
        uploadId: upload.id,
        userId: upload.userId,
        reason,
        rejectedAt: at.toISOString(),
      });
    });
    return outcome === 'recorded' ? 'rejected' : outcome;
  }

  /**
   * Rejects first (so a retry sees the outcome), then removes the private objects. Nothing was
   * written under `photos/`.
   * @param {string} uploadId
   * @param {import('../domain/errors.js').RejectionReason} reason
   */
  async function rejectAndClean(uploadId, reason) {
    const outcome = await reject(uploadId, reason);
    await storage.remove(objectsOf({ id: uploadId, photoKey: null }));
    return outcome;
  }

  /**
   * @param {{ uploadId: string }} input
   * @returns {Promise<'approved' | 'rejected' | 'review' | 'released' | 'finished'>}
   */
  async function processUpload({ uploadId }) {
    const started = await uow.run(async ({ stores }) => {
      const upload = await stores.uploads.findForUpdate(uploadId);
      if (!upload || !['uploaded', 'processing'].includes(upload.status)) return null;
      const photoKey = await stores.uploads.startProcessing(upload.id, randomKey());
      return { ...upload, photoKey };
    });
    if (!started) return 'finished';

    const raw = await storage.read(started.rawKey, started.maxBytes);
    if (sniffImageType(raw.subarray(0, 12)) !== started.contentType) {
      return rejectAndClean(uploadId, 'not_an_image');
    }

    let processed;
    try {
      processed = await images.process(raw);
    } catch (error) {
      if (!(error instanceof ImageRejected)) throw error;
      return rejectAndClean(uploadId, error.reason);
    }

    for (const variant of VARIANT_NAMES) {
      await storage.write(keys.staging(uploadId, variant), bytesOf(processed, variant), {
        contentType: 'image/webp',
      });
    }
    const check = await contentCheck.check({
      userId: started.userId,
      kind: 'photo',
      objectKey: keys.staging(uploadId, 'w1080'),
      contentType: 'image/webp',
    });
    if (check.verdict === 'review') {
      // Human review arrives with the safety module (Phase 7); the upload stays processing.
      logger.info({ uploadId, provider: check.provider }, 'photo held for review');
      return 'review';
    }
    if (check.verdict === 'reject') return rejectAndClean(uploadId, 'moderation');

    const photoKey = /** @type {string} */ (started.photoKey);
    const published = {
      w1080: keys.photo(photoKey, uploadId, 'w1080'),
      w400: keys.photo(photoKey, uploadId, 'w400'),
    };
    for (const variant of VARIANT_NAMES) {
      const key = variant === 'w1080' ? published.w1080 : published.w400;
      await storage.write(key, bytesOf(processed, variant), {
        contentType: 'image/webp',
        cacheControl: PHOTO_CACHE_CONTROL,
      });
    }

    const at = clock.now();
    const outcome = await finish(uploadId, async ({ stores, emit }, upload) => {
      await stores.uploads.markApproved(upload.id, at);
      await emit(photoApproved, {
        photoId: upload.id,
        uploadId: upload.id,
        userId: upload.userId,
        keys: published,
        approvedAt: at.toISOString(),
      });
    });
    if (outcome === 'released') {
      // The user deleted the photo while it was being processed: discard everything.
      await storage.remove(objectsOf({ id: uploadId, photoKey }));
      return 'released';
    }
    await storage.remove([started.rawKey, ...VARIANT_NAMES.map((v) => keys.staging(uploadId, v))]);
    return outcome === 'recorded' ? 'approved' : 'finished';
  }

  return { processUpload, rejectAndClean };
}
