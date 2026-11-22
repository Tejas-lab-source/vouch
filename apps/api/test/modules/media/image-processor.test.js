// @ts-check
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageRejected } from '../../../src/modules/media/domain/errors.js';
import { createSharpProcessor } from '../../../src/modules/media/adapters/image/sharp.js';
import { hasGpsIfd, jpegWithGps, png } from './images.js';

const processor = createSharpProcessor({ maxPixels: 50_000_000, quality: 80 });

describe('image processor (sharp)', () => {
  it('the test JPEG really carries GPS EXIF (precondition)', async () => {
    const meta = await sharp(await jpegWithGps()).metadata();
    expect(meta.exif?.includes(Buffer.from('VouchTestCam'))).toBe(true);
    expect(hasGpsIfd(meta.exif)).toBe(true);
    expect(meta.orientation).toBe(6);
  });

  it('strips all EXIF (including GPS), applies the orientation, and writes WebP at 1080 and 400 px', async () => {
    const result = await processor.process(await jpegWithGps());
    for (const [name, width] of /** @type {const} */ ([
      ['w1080', 1080],
      ['w400', 400],
    ])) {
      const variant = result.variants.get(name);
      const meta = await sharp(variant?.data).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(meta.width).toBe(width);
      // 1600×1200 rotated by EXIF orientation 6 is portrait 1200×1600: aspect ratio kept.
      expect(meta.height).toBe(Math.round((width * 1600) / 1200));
      expect(variant?.data.includes(Buffer.from('VouchTestCam'))).toBe(false);
    }
  });

  it('never upscales a small image', async () => {
    const result = await processor.process(await png(640, 480));
    expect(result.variants.get('w1080')?.width).toBe(640);
    expect(result.variants.get('w400')?.width).toBe(400);
  });

  it('refuses an image over the pixel limit before decoding it', async () => {
    const small = createSharpProcessor({ maxPixels: 1_000_000, quality: 80 });
    await expect(small.process(await png(1200, 1000))).rejects.toThrow(ImageRejected);
    await expect(small.process(await png(1200, 1000))).rejects.toMatchObject({
      reason: 'too_large',
    });
  });

  it('refuses bytes that are not an image, and a truncated image', async () => {
    await expect(processor.process(Buffer.from('not an image at all'))).rejects.toMatchObject({
      reason: 'not_an_image',
    });
    const truncated = (await jpegWithGps()).subarray(0, 2000);
    await expect(processor.process(truncated)).rejects.toMatchObject({ reason: 'not_an_image' });
  });
});
