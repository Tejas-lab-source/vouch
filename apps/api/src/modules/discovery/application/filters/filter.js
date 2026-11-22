// @ts-check

/**
 * @typedef {{ viewer: import('../../ports.js').Viewer, candidates: import('../../ports.js').Candidate[] }} FilterInput
 * @typedef {{ candidates: import('../../ports.js').Candidate[], removed: { userId: string, reason: string }[] }} FilterOutput
 */

/**
 * Builds a `discovery.candidateFilters` step from a predicate over the whole list (so one
 * lookup serves 500 candidates). Each step reports what it removed and why.
 * @param {string} id
 * @param {number} order
 * @param {string} reason  Snake case, logged with each removal.
 * @param {(input: FilterInput) => Promise<(candidate: import('../../ports.js').Candidate) => boolean> | ((candidate: import('../../ports.js').Candidate) => boolean)} keepFor
 * @returns {import('../../../../platform/pipelines.js').PipelineStep}
 */
export function filterStep(id, order, reason, keepFor) {
  return {
    id,
    order,
    run: async (/** @type {FilterInput} */ input) => {
      const keep = await keepFor(input);
      /** @type {FilterOutput} */
      const output = { candidates: [], removed: [] };
      for (const candidate of input.candidates) {
        if (keep(candidate)) output.candidates.push(candidate);
        else output.removed.push({ userId: candidate.userId, reason });
      }
      return output;
    },
  };
}
