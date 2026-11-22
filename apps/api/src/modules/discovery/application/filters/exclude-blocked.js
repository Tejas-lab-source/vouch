// @ts-check
import { filterStep, QUERY_STEP_TIMEOUT_MS } from './filter.js';

/**
 * Drop anyone in a block with the viewer, in either direction (`safety.blockPolicy`).
 * @param {{ blockedAmong: (viewerId: string, ids: readonly string[]) => Promise<Set<string>> }} deps
 */
export const excludeBlocked = ({ blockedAmong }) =>
  filterStep(
    'discovery.excludeBlocked',
    30,
    'blocked',
    async ({ viewer, candidates }) => {
      const blocked = await blockedAmong(
        viewer.userId,
        candidates.map((c) => c.userId),
      );
      return (c) => !blocked.has(c.userId);
    },
    QUERY_STEP_TIMEOUT_MS,
  );
