// @ts-check
import { filterStep, QUERY_STEP_TIMEOUT_MS } from './filter.js';

/**
 * Drop anyone the viewer already liked or passed (`matching.seen_v`).
 * @param {{ swipedAmong: import('../../ports.js').CandidateSource['swipedAmong'] }} deps
 */
export const excludeSwiped = ({ swipedAmong }) =>
  filterStep(
    'discovery.excludeSwiped',
    20,
    'swiped',
    async ({ viewer, candidates }) => {
      const swiped = await swipedAmong(
        viewer.userId,
        candidates.map((c) => c.userId),
      );
      return (c) => !swiped.has(c.userId);
    },
    QUERY_STEP_TIMEOUT_MS,
  );
