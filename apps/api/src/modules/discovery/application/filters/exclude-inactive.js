// @ts-check
import { filterStep } from './filter.js';

/**
 * Drop banned users (`safety.bannedAmong`). Deleted and inactive accounts never reach this
 * point: the candidate source joins `identity.active_users_v`.
 * @param {{ bannedAmong: (ids: readonly string[]) => Promise<Set<string>> }} deps
 */
export const excludeInactive = ({ bannedAmong }) =>
  filterStep('discovery.excludeInactive', 40, 'banned', async ({ candidates }) => {
    const banned = await bannedAmong(candidates.map((c) => c.userId));
    return (c) => !banned.has(c.userId);
  });
