// @ts-check
import { exposureScore } from '../../domain/scores.js';

/**
 * Daily exposure cap (`DISCOVERY_EXPOSURE_CAP`): a gate, so a candidate shown `cap` times today
 * leaves the deck. Counts are read once per build (`counts`), not once per candidate.
 * @param {{ cap: number, counts: () => Map<string, number> }} deps
 * @returns {import('../../../../platform/pipelines.js').PipelineStep}
 */
export const exposureCap = ({ cap, counts }) => ({
  id: 'discovery.exposureCap',
  order: 40,
  run: ({ candidate }) => {
    const shown = counts().get(candidate.userId) ?? 0;
    return { score: exposureScore(shown, cap), reason: `shown ${shown}/${cap} today` };
  },
});
