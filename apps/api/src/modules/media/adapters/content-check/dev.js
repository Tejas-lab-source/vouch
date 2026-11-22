// @ts-check

/**
 * Development `ContentCheck`: approves everything. Phase 7 replaces it with the
 * `safety.contentChecks` pipeline and a real moderation provider; production config refuses
 * `MODERATION_PROVIDER=dev`.
 * @returns {import('../../ports.js').ContentCheck}
 */
export function createDevContentCheck() {
  return {
    check: async () => ({ verdict: 'approve', reasons: [], provider: 'dev' }),
  };
}
