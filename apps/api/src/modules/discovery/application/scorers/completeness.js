// @ts-check
import { completenessScore } from '../../domain/scores.js';

/**
 * More approved photos rank higher.
 * @param {{ maxPhotos: number }} deps
 * @returns {import('../../../../platform/pipelines.js').PipelineStep}
 */
export const completeness = ({ maxPhotos }) => ({
  id: 'discovery.completeness',
  order: 20,
  run: ({ candidate }) => ({
    score: completenessScore(candidate.approvedPhotos, maxPhotos),
    reason: `${candidate.approvedPhotos}/${maxPhotos} photos`,
  }),
});
