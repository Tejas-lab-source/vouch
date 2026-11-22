// @ts-check
import { recencyScore } from '../../domain/scores.js';

/**
 * Recently active people first (half-life `DISCOVERY_RECENCY_HALF_LIFE_HOURS`).
 * @param {{ clock: { now: () => Date }, halfLifeHours: number }} deps
 * @returns {import('../../../../platform/pipelines.js').PipelineStep}
 */
export const recency = ({ clock, halfLifeHours }) => ({
  id: 'discovery.recency',
  order: 10,
  run: ({ candidate }) => {
    const hours = Math.round(
      (clock.now().getTime() - Date.parse(candidate.lastActiveAt)) / 3_600_000,
    );
    return {
      score: recencyScore(new Date(candidate.lastActiveAt), clock.now(), halfLifeHours),
      reason: `active ${hours} h ago`,
    };
  },
});
