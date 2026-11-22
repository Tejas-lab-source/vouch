// @ts-check

/** Why an upload was refused; the values match `photo.rejected.v1`'s `reason`. */
export const REJECTION_REASONS = Object.freeze(
  /** @type {const} */ (['not_an_image', 'too_large', 'moderation', 'processing_failed']),
);

/** @typedef {typeof REJECTION_REASONS[number]} RejectionReason */

/** Thrown by the image processor for input it refuses (as opposed to an infrastructure error). */
export class ImageRejected extends Error {
  /** @param {'not_an_image' | 'too_large'} reason */
  constructor(reason) {
    super(`image rejected: ${reason}`);
    this.name = 'ImageRejected';
    this.reason = reason;
  }
}
