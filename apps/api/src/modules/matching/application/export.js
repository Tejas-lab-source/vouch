// @ts-check
import { otherUser } from '../domain/pair.js';

/**
 * Matching's part of the data export: the user's swipes and matches, with public ids only.
 * @param {Pick<import('../ports.js').MatchingDeps, 'read' | 'identity'>} deps
 */
export function makeMatchingExport({ read, identity }) {
  /** @param {string} userId */
  return async (userId) => {
    const { swipes, matches } = await read(async (stores) => ({
      swipes: await stores.swipes.forUser(userId),
      matches: await stores.matches.allForUser(userId),
    }));
    const others = [
      ...new Set([...swipes.map((s) => s.targetId), ...matches.map((m) => otherUser(m, userId))]),
    ];
    const publicIds = new Map(
      (await identity.getUsersByIds(others)).map((u) => [u.id, u.publicId]),
    );
    return {
      swipes: swipes.map((s) => ({
        userId: publicIds.get(s.targetId) ?? null,
        direction: s.direction === 1 ? 'like' : 'pass',
        at: s.createdAt.toISOString(),
      })),
      matches: matches.map((m) => ({
        matchId: m.id,
        userId: m.anonymisedAt ? null : (publicIds.get(otherUser(m, userId)) ?? null),
        createdAt: m.createdAt.toISOString(),
        unmatchedAt: m.unmatchedAt?.toISOString() ?? null,
      })),
    };
  };
}
