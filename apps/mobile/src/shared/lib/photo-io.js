// @ts-check
import { fitWithin, xhrPut } from '@vouch/features-core';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Resizes a picked image to at most 2048 px on the long edge and re-encodes it as JPEG (0.9).
 * Re-encoding drops EXIF, including location. The body is a Blob read from the local file.
 * @param {{ uri: string, width: number, height: number }} asset  From expo-image-picker.
 * @returns {Promise<import('@vouch/features-core').PreparedImage>}
 */
export async function prepareImage(asset) {
  const size = fitWithin(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (size.width !== asset.width) context.resize(size);
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const blob = await (await fetch(result.uri)).blob();
  return { body: blob, contentType: 'image/jpeg', sizeBytes: blob.size };
}

/** @type {import('@vouch/features-core').PhotoIo} */
export const nativePhotoIo = { prepare: prepareImage, put: xhrPut };
