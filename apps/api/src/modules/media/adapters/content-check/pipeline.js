// @ts-check

/** Owned by safety (Phase 7); media only runs it. */
const CONTENT_CHECKS = 'safety.contentChecks';

/**
 * `ContentCheck` through the `safety.contentChecks` pipeline (fail closed). Every step judges
 * the same photo; the strictest verdict wins (reject, then review, then approve). A chain with
 * no verdict at all throws: a photo is never approved without one.
 * @param {{ collect: (name: string, input: unknown) => Promise<{ id: string, value: any }[]> }} pipelines
 * @returns {import('../../ports.js').ContentCheck}
 */
export function createPipelineContentCheck(pipelines) {
  return {
    async check(input) {
      const results = await pipelines.collect(CONTENT_CHECKS, input);
      if (results.length === 0) throw new Error(`${CONTENT_CHECKS} returned no verdict`);
      const verdicts = results.map((r) => r.value);
      const strictest =
        verdicts.find((v) => v.verdict === 'reject') ??
        verdicts.find((v) => v.verdict === 'review') ??
        verdicts[0];
      return {
        verdict: strictest.verdict,
        reasons: verdicts.flatMap((v) => v.reasons),
        provider: verdicts.map((v) => v.provider).join(','),
      };
    },
  };
}
