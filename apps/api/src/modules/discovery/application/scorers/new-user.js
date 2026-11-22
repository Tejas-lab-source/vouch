// @ts-check
import { newUserScore } from '../../domain/scores.js';

/**
 * New users get exposure while they start (`DISCOVERY_NEW_USER_DAYS`).
 * @param {{ clock: { now: () => Date }, days: number }} deps
 * @returns {import('../../../../platform/pipelines.js').PipelineStep}
 */
export const newUser = ({ clock, days }) => ({
  id: 'discovery.newUser',
  order: 30,
  run: ({ candidate }) => {
    const score = newUserScore(new Date(candidate.createdAt), clock.now(), days);
    return { score, reason: score > 0 ? `joined within ${days} days` : 'established' };
  },
});
