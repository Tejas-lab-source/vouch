// @ts-check

/** Same budget as discovery's filters that query (worker path only). */
const TIMEOUT_MS = 250;

/**
 * A `discovery.candidateFilters` step contributed by matching (extension point 7): a person
 * the viewer passed is excluded even while the pass is still in the Redis buffer, so they
 * cannot reappear in a deck built before the next flush.
 * @param {{ pendingFor: (swiperId: string) => Promise<Set<string>> }} deps
 * @returns {import('../../../../platform/pipelines.js').PipelineStep}
 */
export function excludeBufferedPasses({ pendingFor }) {
  return {
    id: 'matching.excludeBufferedPasses',
    order: 25,
    timeoutMs: TIMEOUT_MS,
    run: async (
      /** @type {{ viewer: { userId: string }, candidates: { userId: string }[] }} */ input,
    ) => {
      const pending = await pendingFor(input.viewer.userId);
      /** @type {{ candidates: typeof input.candidates, removed: { userId: string, reason: string }[] }} */
      const output = { candidates: [], removed: [] };
      for (const c of input.candidates) {
        if (pending.has(c.userId)) output.removed.push({ userId: c.userId, reason: 'passed' });
        else output.candidates.push(c);
      }
      return output;
    },
  };
}
