// @ts-check

/** WebP variants written for every approved photo: name → width in pixels (never upscaled). */
export const VARIANTS = Object.freeze({ w1080: 1080, w400: 400 });

/** @typedef {keyof typeof VARIANTS} VariantName */

/** Variant names in a fixed order: `w1080`, `w400`. */
export const VARIANT_NAMES = /** @type {VariantName[]} */ (Object.keys(VARIANTS));

const WIDTHS = new Map(Object.entries(VARIANTS));

/** @param {VariantName} variant */
export const widthOf = (variant) => WIDTHS.get(variant) ?? 0;

/** Cache header for approved variants: their keys never change, so they can be cached forever. */
export const PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Object keys (ADR 0012). Raw uploads and processed variants awaiting moderation live under
 * `uploads/`, which is private and expires after 1 day. Approved variants live under
 * `photos/{photoKey}/{photoId}_{size}.webp`: `photoKey` is random per photo, so a URL carries
 * no internal user id and cannot be linked to the account or to the user's other photos.
 */
export const keys = Object.freeze({
  /** @param {string} uploadId */
  raw: (uploadId) => `uploads/raw/${uploadId}`,
  /** @param {string} uploadId @param {VariantName} variant */
  staging: (uploadId, variant) => `uploads/processed/${uploadId}_${widthOf(variant)}.webp`,
  /** @param {string} uploadId @param {VariantName} variant  Held for human review (Phase 7). */
  review: (uploadId, variant) => `review/${uploadId}_${widthOf(variant)}.webp`,
  /** @param {string} photoKey @param {string} photoId @param {VariantName} variant */
  photo: (photoKey, photoId, variant) => `photos/${photoKey}/${photoId}_${widthOf(variant)}.webp`,
});

/**
 * Every object an upload can own, for deletion.
 * @param {{ id: string, photoKey: string | null }} upload
 * @returns {string[]}
 */
export function objectsOf(upload) {
  return [
    keys.raw(upload.id),
    ...VARIANT_NAMES.map((v) => keys.staging(upload.id, v)),
    ...VARIANT_NAMES.map((v) => keys.review(upload.id, v)),
    ...(upload.photoKey
      ? VARIANT_NAMES.map((v) => keys.photo(upload.photoKey ?? '', upload.id, v))
      : []),
  ];
}

/**
 * Upload rows that ended without a photo (rejected, or presigned and never confirmed) are
 * deleted after 7 days (docs/data-model.md, Retention). Approved rows stay while the photo
 * exists: they hold its photo key and count toward the limit.
 */
export const UPLOAD_ROW_RETENTION_MS = 7 * 24 * 3600 * 1000;

/** Only these prefixes may be deleted through the public API. */
export const DELETABLE_PREFIXES = Object.freeze(['photos/', 'uploads/', 'review/']);

/**
 * The image type a file really is, from its first bytes (magic numbers), regardless of its
 * name or declared content type.
 * @param {Uint8Array} head  At least the first 12 bytes.
 * @returns {'image/jpeg' | 'image/png' | 'image/webp' | null}
 */
export function sniffImageType(head) {
  const at = (/** @type {number} */ i) => head.at(i);
  const ascii = (/** @type {number} */ from, /** @type {number} */ to) =>
    String.fromCharCode(...head.subarray(from, to));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * @typedef {'pending' | 'uploaded' | 'processing' | 'in_review' | 'approved' | 'rejected' | 'expired'} UploadStatus
 */

/**
 * Whether an upload counts toward the photo limit. Rejected uploads never count; a presigned
 * upload that was never confirmed stops counting once its URL has expired.
 * @param {{ status: UploadStatus, createdAt: Date }} upload
 * @param {Date} now
 * @param {number} urlTtlMs
 */
export function countsTowardLimit(upload, now, urlTtlMs) {
  if (upload.status === 'pending') return now.getTime() - upload.createdAt.getTime() < urlTtlMs;
  return ['uploaded', 'processing', 'in_review', 'approved'].includes(upload.status);
}

/**
 * What confirming an upload does, given its state and the stored object's metadata.
 * @param {{ status: UploadStatus, contentType: string, maxBytes: number }} upload
 * @param {{ contentLength: number, contentType: string | null } | null} object  From a HEAD request.
 * @returns {'confirm' | 'not_uploaded' | { already: 'processing' | 'approved' | 'rejected' }}
 */
export function judgeConfirm(upload, object) {
  if (['uploaded', 'processing', 'in_review'].includes(upload.status)) {
    return { already: 'processing' };
  }
  if (upload.status === 'approved' || upload.status === 'rejected') {
    return { already: upload.status };
  }
  if (upload.status === 'expired' || object === null) return 'not_uploaded';
  if (object.contentLength !== upload.maxBytes || object.contentType !== upload.contentType) {
    return 'not_uploaded';
  }
  return 'confirm';
}
