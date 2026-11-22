// @ts-check
import { PIPELINES } from '@vouch/contracts';
import { makeBans, makeBlocks } from '../application/blocks.js';
import { CONTENT_CHECKS, imageModerationStep } from '../application/content-checks.js';
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
    const definition = new Map(Object.entries(PIPELINES)).get(CONTENT_CHECKS);
    if (!definition) throw new Error(`pipeline ${CONTENT_CHECKS} is not in the contracts`);
    pipelines.define(CONTENT_CHECKS, {
      failClosed: definition.failClosed,
      stepTimeoutMs: definition.stepTimeoutMs,
    });
    definedOn.add(pipelines);
  }
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('safety', createSafetyStores),
    read: (fn) => db.read('safety', (/** @type {any} */ tx) => fn(createSafetyStores(tx))),
    storesFor: createSafetyStores,
    blockCache: createBlockCache({ redis: redis.command }),
    identity: ctx.deps.identity,
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
  return {
    ...makeBlocks(deps),
    bans: makeBans(deps),
    contentStep: imageModerationStep(deps),
  };
}
