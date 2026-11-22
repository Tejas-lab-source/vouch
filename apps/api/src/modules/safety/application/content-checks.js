// @ts-check
import { judgeModeration } from '../domain/moderation.js';

/** The chain safety owns (fail closed: no verdict means no approval). */
export const CONTENT_CHECKS = 'safety.contentChecks';

/**
 * The image-moderation step of `safety.contentChecks`: asks the moderation provider about the
 * processed image and turns its findings into a verdict.
 * @param {Pick<import('../ports.js').SafetyDeps, 'moderation' | 'thresholds'>} deps
 * @returns {import('../../../platform/pipelines.js').PipelineStep}
 */
export function imageModerationStep({ moderation, thresholds }) {
  return {
    id: 'safety.imageModeration',
    order: 10,
    run: async (/** @type {{ kind: string, image?: Uint8Array }} */ input) => {
      if (input.kind !== 'photo' || !input.image) {
        throw new Error('image moderation needs the photo bytes');
      }
      const verdict = judgeModeration(await moderation.inspect(input.image), thresholds);
      return { ...verdict, provider: moderation.name };
    },
  };
}
