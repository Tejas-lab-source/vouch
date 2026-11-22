// @ts-check
import { PIPELINES } from '@vouch/contracts';
import { makeBans, makeBlocks } from '../application/blocks.js';
import { CONTENT_CHECKS, imageModerationStep } from '../application/content-checks.js';
import { makeModeration, REPORT_EVIDENCE } from '../application/moderation.js';
import { createDevModeration } from './moderation/dev.js';
import { createRekognitionModeration } from './moderation/rekognition.js';
import { createSafetyStores } from './pg/stores.js';
import { createBlockCache } from './redis/block-cache.js';

const definedOn = new WeakSet();

/**
 * @param {import('../../../platform/config.js').Config} config
 * @returns {import('../ports.js').ModerationProvider}
 */
function moderationProvider(config) {
  if (config.MODERATION_PROVIDER === 'dev') return createDevModeration();
  if (config.MODERATION_PROVIDER === 'rekognition') {
    return createRekognitionModeration({
      region: config.MODERATION_AWS_REGION,
      accessKeyId: String(config.MODERATION_AWS_ACCESS_KEY_ID),
      secretAccessKey: String(config.MODERATION_API_KEY),
      endpoint: config.MODERATION_ENDPOINT,
      minConfidence: config.MODERATION_REVIEW_CONFIDENCE,
      faceAgeCheck: config.MODERATION_FACE_AGE_CHECK,
    });
  }
  throw new Error(`MODERATION_PROVIDER ${config.MODERATION_PROVIDER} is not supported`);
}

/**
 * Builds safety's dependencies and defines the chain it owns.
 * @param {any} ctx  Registry context; optional `overrides.safety.moderation`.
 * @returns {import('../ports.js').SafetyDeps}
 */
export function buildSafetyDeps(ctx) {
  const { config, db, redis, clock, logger, pipelines } = ctx;
  if (!definedOn.has(pipelines)) {
    for (const name of [CONTENT_CHECKS, REPORT_EVIDENCE]) {
      const definition = new Map(Object.entries(PIPELINES)).get(name);
      if (!definition) throw new Error(`pipeline ${name} is not in the contracts`);
      pipelines.define(name, {
        failClosed: definition.failClosed,
        stepTimeoutMs: definition.stepTimeoutMs,
      });
    }
    definedOn.add(pipelines);
  }
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('safety', createSafetyStores),
    read: (fn) => db.read('safety', (/** @type {any} */ tx) => fn(createSafetyStores(tx))),
    storesFor: createSafetyStores,
    blockCache: createBlockCache({ redis: redis.command }),
    identity: ctx.deps.identity,
    profiles: ctx.deps.profiles,
    media: ctx.deps.media,
    pipelines,
    rateLimiter: ctx.rateLimiter,
    redis: redis.command,
    newId: ctx.newId,
    settings: {
      autohideReporters: config.REPORT_AUTOHIDE_REPORTERS,
      autohideDays: config.REPORT_AUTOHIDE_DAYS,
      reportsPerDay: config.REPORTS_PER_DAY,
      rejectionsForReview: config.PHOTO_REJECTIONS_FOR_REVIEW,
      uploadMaxBytes: config.UPLOAD_MAX_BYTES,
    },
    moderation: ctx.overrides?.safety?.moderation ?? moderationProvider(config),
    thresholds: {
      rejectConfidence: config.MODERATION_REJECT_CONFIDENCE,
      reviewConfidence: config.MODERATION_REVIEW_CONFIDENCE,
      minorAge: config.MODERATION_MINOR_AGE,
    },
    clock,
    logger: logger.child({ module: 'safety' }),
  };
}

/** @param {import('../ports.js').SafetyDeps} deps */
export function buildSafetyHandlers(deps) {
  const blocks = makeBlocks(deps);
  return {
    ...blocks,
    bans: makeBans(deps),
    contentStep: imageModerationStep(deps),
    ...makeModeration(/** @type {any} */ (deps)),
    /**
     * `user.deleted.v1`: erases the user's blocks, ID-card reviews and images, and offence
     * counts. Reports stay as moderation records (1 year after close); an active ban stays so
     * the account cannot come back.
     * @param {{ userId: string }} payload
     * @param {{ tx: import('postgres').TransactionSql }} context
     */
    eraseUser: async ({ userId }, { tx }) => {
      const { others, imageKeys } = await deps.storesFor(tx).erasure.eraseUser(userId);
      await /** @type {any} */ (deps).media.privateObjects.remove(imageKeys);
      for (const other of others) await deps.blockCache.forget(userId, other).catch(() => {});
    },
  };
}
