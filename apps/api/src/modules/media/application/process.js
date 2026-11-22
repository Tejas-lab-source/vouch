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
   * @param {readonly string[]} [expect]  Statuses the outcome may be recorded from.
   * @returns {Promise<'recorded' | 'released' | 'finished'>}
   */
  const finish = (uploadId, apply, expect = ['processing']) =>
    uow.run(async (scope) => {
      const upload = await scope.stores.uploads.findForUpdate(uploadId);
      if (!upload) return 'released';
      if (!expect.includes(upload.status)) return 'finished';
      await apply(scope, upload);
      return 'recorded';
    });

  /**
   * @param {string} uploadId
   * @param {import('../domain/errors.js').RejectionReason} reason
   * @param {readonly string[]} [expect]
   */
  async function reject(uploadId, reason, expect = ['processing']) {
    const at = clock.now();
    const outcome = await finish(
      uploadId,
      async ({ stores, emit }, upload) => {
        await stores.uploads.markRejected(upload.id, reason, at);
        await emit(photoRejected, {
          photoId: upload.id,
          uploadId: upload.id,
          userId: upload.userId,
          reason,
          rejectedAt: at.toISOString(),
        });
      },
      expect,
    );
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
      image: bytesOf(processed, 'w1080'),
    });
    if (check.verdict === 'reject') return rejectAndClean(uploadId, 'moderation');
    if (check.verdict === 'review') return holdForReview(started, processed, check.reasons);

    const outcome = await publish(started, (variant) => bytesOf(processed, variant));
    if (outcome === 'approved') await removePrivate(started.rawKey, uploadId, 'staging');
    return outcome;
  }

  /**
   * Keeps the variants under the private `review/` prefix (outside `uploads/`, which expires
   * after 1 day) and marks the upload `in_review`. The owner still sees the photo as pending;
   * the moderation queue (Phase 10) decides with `resolveReview`.
   * @param {import('../ports.js').UploadRecord} upload
   * @param {import('../ports.js').ProcessedImage} processed
   * @param {string[]} reasons
   */
  async function holdForReview(upload, processed, reasons) {
    for (const variant of VARIANT_NAMES) {
      await storage.write(keys.review(upload.id, variant), bytesOf(processed, variant), {
        contentType: 'image/webp',
      });
    }
    const outcome = await finish(upload.id, ({ stores }, row) =>
      stores.uploads.markInReview(row.id),
    );
    if (outcome === 'released') {
      await storage.remove(objectsOf(upload));
      return 'released';
    }
    await removePrivate(upload.rawKey, upload.id, 'staging');
    logger.info({ uploadId: upload.id, reasons }, 'photo held for review');
    return outcome === 'recorded' ? 'review' : 'finished';
  }

  /**
   * Writes the public variants, then records the approval and emits `photo.approved.v1`. If
   * the upload was released meanwhile, everything written is deleted.
   * @param {import('../ports.js').UploadRecord} upload  With its photo key.
   * @param {(variant: import('../domain/upload.js').VariantName) => Buffer} bytes
   * @param {readonly string[]} [expect]  Statuses the upload may be in (default processing).
   * @returns {Promise<'approved' | 'released' | 'finished'>}
   */
  async function publish(upload, bytes, expect = ['processing']) {
    const uploadId = upload.id;
    const photoKey = /** @type {string} */ (upload.photoKey);
    const published = {
      w1080: keys.photo(photoKey, uploadId, 'w1080'),
      w400: keys.photo(photoKey, uploadId, 'w400'),
    };
    for (const variant of VARIANT_NAMES) {
      const key = variant === 'w1080' ? published.w1080 : published.w400;
      await storage.write(key, bytes(variant), {
        contentType: 'image/webp',
        cacheControl: PHOTO_CACHE_CONTROL,
      });
    }

    const at = clock.now();
    const outcome = await finish(
      uploadId,
      async ({ stores, emit }, row) => {
        await stores.uploads.markApproved(row.id, at);
        await emit(photoApproved, {
          photoId: row.id,
          uploadId: row.id,
          userId: row.userId,
          keys: published,
          approvedAt: at.toISOString(),
        });
      },
      expect,
    );
    if (outcome === 'released') {
      // The user deleted the photo while it was being processed: discard everything.
      await storage.remove(objectsOf({ id: uploadId, photoKey }));
      return 'released';
    }
    return outcome === 'recorded' ? 'approved' : 'finished';
  }

  /**
   * Deletes the raw object and one set of private variants.
   * @param {string} rawKey
   * @param {string} uploadId
   * @param {'staging' | 'review'} prefix
   */
  async function removePrivate(rawKey, uploadId, prefix) {
    await storage.remove([
      rawKey,
      ...VARIANT_NAMES.map((v) => (prefix === 'review' ? keys.review : keys.staging)(uploadId, v)),
    ]);
  }

  /**
   * The moderation queue's decision on a photo held for review (Phase 10 calls this).
   * Approve publishes the held variants; reject records `moderation`. Idempotent.
   * @param {string} uploadId
   * @param {'approve' | 'reject'} decision
   * @returns {Promise<'approved' | 'rejected' | 'released' | 'finished'>}
   */
  async function resolveReview(uploadId, decision) {
    const upload = await uow.run(({ stores }) => stores.uploads.findForUpdate(uploadId));
    if (!upload) return 'released';
    if (upload.status !== 'in_review') return 'finished';
    if (decision === 'reject') {
      const outcome = await reject(uploadId, 'moderation', ['in_review']);
      await storage.remove(objectsOf({ id: uploadId, photoKey: null }));
      return outcome;
    }
    const held = new Map();
    for (const variant of VARIANT_NAMES) {
      held.set(variant, await storage.read(keys.review(uploadId, variant), 10_485_760));
    }
    const outcome = await publish(upload, (variant) => held.get(variant), ['in_review']);
    if (outcome === 'approved') await removePrivate(upload.rawKey, uploadId, 'review');
    return outcome;
  }

  return { processUpload, rejectAndClean, resolveReview };
}
