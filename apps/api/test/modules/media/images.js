// @ts-check
import sharp from 'sharp';

/**
 * Test images, generated rather than committed.
 * A JPEG with GPS coordinates, a camera make and an EXIF orientation of 6 (rotate 90°).
 * @param {{ width?: number, height?: number }} [size]
 */
export function jpegWithGps({ width = 1600, height = 1200 } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: 'VouchTestCam', Model: 'Model X' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '18/1 31/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '73/1 51/1 0/1',
      },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** @param {number} width @param {number} height */
export function png(width, height) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 200, b: 90, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/**
 * Whether an EXIF block has a GPS IFD: the GPSInfo pointer tag 0x8825, in either byte order.
 * @param {Buffer | undefined} exif
 */
export function hasGpsIfd(exif) {
  if (!exif) return false;
  return exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]));
}
