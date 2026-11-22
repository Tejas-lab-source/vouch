// @ts-check
import sharp from 'sharp';
import { ImageRejected } from '../../domain/errors.js';
import { VARIANT_NAMES, widthOf } from '../../domain/upload.js';

/**
 * `ImageProcessor` with sharp, tuned for a 512 MB instance (ADR 0012):
 * - The header is read first, and anything over `maxPixels` is refused before decoding.
 * - Each variant is its own pipeline from the encoded input, so JPEG and WebP use
 *   shrink-on-load: libvips decodes at a reduced scale instead of decoding all 50 MP.
 * - `sequentialRead` streams the decode, the libvips cache is off and one thread works per
 *   image (`IMAGE_WORKER_CONCURRENCY` sets how many images run at once).
 * - `rotate()` applies the EXIF orientation; sharp writes no metadata unless asked, so EXIF
 *   (including GPS), XMP and ICC profiles are all dropped.
 * @param {{ maxPixels: number, quality: number }} options
 * @returns {import('../../ports.js').ImageProcessor}
 */
export function createSharpProcessor({ maxPixels, quality }) {
  sharp.cache(false);
  sharp.concurrency(1);
  const input = {
    limitInputPixels: maxPixels,
    sequentialRead: true,
    failOn: /** @type {const} */ ('error'),
  };

  /** @param {Buffer} buffer */
  async function header(buffer) {
    try {
      return await sharp(buffer, input).metadata();
    } catch (error) {
      throw /pixel limit/i.test(String(error))
        ? new ImageRejected('too_large')
        : new ImageRejected('not_an_image');
    }
  }

  return {
    async process(buffer) {
      const meta = await header(buffer);
      const width = meta.autoOrient?.width ?? meta.width;
      const height = meta.autoOrient?.height ?? meta.height;
      if (!width || !height) throw new ImageRejected('not_an_image');
      if (width * height > maxPixels) throw new ImageRejected('too_large');

      /** @type {import('../../ports.js').ProcessedImage['variants']} */
      const variants = new Map();
      for (const name of VARIANT_NAMES) {
        try {
          const { data, info } = await sharp(buffer, input)
            .rotate()
            .resize({ width: widthOf(name), withoutEnlargement: true })
            .webp({ quality })
            .toBuffer({ resolveWithObject: true });
          variants.set(name, { data, width: info.width, height: info.height });
        } catch {
          throw new ImageRejected('not_an_image');
        }
      }
      return {
        variants,
        source: { width, height, format: String(meta.format) },
      };
    },
  };
}
