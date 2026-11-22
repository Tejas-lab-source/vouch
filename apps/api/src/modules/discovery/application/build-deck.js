// @ts-check
import { DECK } from '../domain/deck.js';
import { dayKey } from '../domain/scores.js';

export const CANDIDATE_FILTERS = 'discovery.candidateFilters';
export const SCORERS = 'discovery.scorers';

/**
 * The deck worker (job `discovery.buildDeck`): candidates → filters → scorers → ranker → the
 * top 50 ids in Redis. Never runs on the request path.
 * @param {import('../ports.js').DiscoveryDeps & { exposure: { prefetch: (ids: readonly string[], day: string) => Promise<void> } }} deps
 */
export function makeBuildDeck({ source, decks, ranker, pipelines, exposure, clock, logger }) {
  /**
   * Runs every filter on the same input and keeps candidates that all of them kept. A filter
   * that fails or times out is skipped (the chain fails open); the candidate source already
   * applies the same exclusions in SQL, and the read path re-checks blocks.
   * @param {import('../ports.js').Viewer} viewer
   * @param {import('../ports.js').Candidate[]} candidates
   */
  async function filter(viewer, candidates) {
    const results = await pipelines.collect(CANDIDATE_FILTERS, { viewer, candidates });
    /** @type {Map<string, string>} */
    const removed = new Map();
    for (const { value } of results) {
      const output = /** @type {import('./filters/filter.js').FilterOutput} */ (value);
      for (const r of output.removed) if (!removed.has(r.userId)) removed.set(r.userId, r.reason);
    }
    return { kept: candidates.filter((c) => !removed.has(c.userId)), removed };
  }

  /**
   * @param {{ userId: string, reason: string }} input
   * @returns {Promise<{ built: boolean, size: number }>}
   */
  return async function buildDeck({ userId, reason }) {
    const now = clock.now();
    const viewer = await source.viewer(userId, now);
    if (!viewer) {
      await decks.drop(userId);
      return { built: false, size: 0 };
    }
    const candidates = await source.candidates(viewer, now, DECK.candidateLimit);
    const { kept, removed } = await filter(viewer, candidates);
    await exposure.prefetch(
      kept.map((c) => c.userId),
      dayKey(now),
    );
    const scored = await Promise.all(
      kept.map(async (candidate) => ({
        candidate,
        scores: new Map(
          (await pipelines.collect(SCORERS, { viewer, candidate })).map(({ id, value }) => [
            id,
            /** @type {{ score: number, reason: string }} */ (value),
          ]),
        ),
      })),
    );
    const deck = ranker.rank(scored);
    await decks.write(
      userId,
      deck.map((r) => r.userId),
    );
    logger.debug(
      {
        viewerId: userId,
        reason,
        candidates: candidates.length,
        removed: Object.fromEntries(
          [...removed.values()].reduce(
            (counts, why) => counts.set(why, (counts.get(why) ?? 0) + 1),
            new Map(),
          ),
        ),
        deck: deck.slice(0, DECK.page).map((r) => ({
          userId: r.userId,
          total: Number(r.total.toFixed(3)),
          reasons: r.reasons,
        })),
      },
      'deck built',
    );
    return { built: true, size: deck.length };
  };
}
