// @ts-check
import { randomBytes } from 'node:crypto';
import { lockKey } from '../../../platform/locks.js';
import { makeProcessing } from '../application/process.js';
import { makeRelease } from '../application/release.js';
import { makeRetention } from '../application/retention.js';
import { makeUploadUseCases } from '../application/uploads.js';
import { createDevContentCheck } from './content-check/dev.js';
import { createSharpProcessor } from './image/sharp.js';
import { createMediaStores } from './pg/stores.js';
import { createS3Storage } from './storage/s3.js';

/**
 * @typedef {object} MediaOverrides  Test seams.
 * @property {import('../ports.js').StorageProvider} [storage]
 * @property {import('../ports.js').ContentCheck} [contentCheck]
 */

/**
 * Builds the media module's dependencies from the platform context.
 * @param {any} ctx  Registry context; optional `overrides.media`.
 * @returns {import('../ports.js').MediaDeps}
 */
export function buildMediaDeps(ctx) {
  const { config, db, clock, logger } = ctx;
  /** @type {MediaOverrides} */
  const overrides = ctx.overrides?.media ?? {};
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('media', createMediaStores),
    read: (fn) => db.read('media', (/** @type {any} */ tx) => fn(createMediaStores(tx))),
    storage:
      overrides.storage ??
      createS3Storage({
        endpoint: config.R2_ENDPOINT,
        accountId: config.R2_ACCOUNT_ID,
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        bucket: config.R2_BUCKET,
      }),
    images: createSharpProcessor({
      maxPixels: config.IMAGE_MAX_PIXELS,
      quality: config.IMAGE_WEBP_QUALITY,
    }),
    contentCheck: overrides.contentCheck ?? createDevContentCheck(),
    settings: {
      photosMax: config.PHOTOS_MAX,
      uploadMaxBytes: config.UPLOAD_MAX_BYTES,
      uploadUrlTtlSeconds: config.UPLOAD_URL_TTL_SECONDS,
      cdnBaseUrl: config.CDN_BASE_URL,
    },
    clock,
    newId: ctx.newId,
    randomKey: () => randomBytes(16).toString('base64url'),
    lockKey,
    logger: logger.child({ module: 'media' }),
  };
}

/** @param {import('../ports.js').MediaDeps} deps */
export function buildMediaHandlers(deps) {
  return {
    ...makeUploadUseCases(deps),
    processing: makeProcessing(deps),
    release: makeRelease(deps),
    purgeUploads: makeRetention(deps),
  };
}
