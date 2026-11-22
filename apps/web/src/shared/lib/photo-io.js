// @ts-check
import { fitWithin, xhrPut } from '@vouch/features-core';

/** Formats the server accepts (`ImageContentType`). */
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const ACCEPT_ATTRIBUTE = [...ACCEPTED].join(',');

/**
 * Resizes a picked image to at most 2048 px on the long edge and re-encodes it as JPEG
 * (quality 0.9). Re-encoding through a canvas drops all metadata, including GPS location.
 * `imageOrientation: 'from-image'` applies the EXIF rotation first.
 * @param {File} file
 * @returns {Promise<import('@vouch/features-core').PreparedImage>}
 */
export async function prepareImage(file) {
  if (!ACCEPTED.has(file.type)) throw new Error('unsupported image type');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d canvas');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.9),
  );
  return { body: blob, contentType: 'image/jpeg', sizeBytes: /** @type {Blob} */ (blob).size };
}

/** @type {import('@vouch/features-core').PhotoIo} */
export const webPhotoIo = { prepare: prepareImage, put: xhrPut };
