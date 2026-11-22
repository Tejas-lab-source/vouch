// @ts-check

/**
 * Development moderation: finds nothing, so every photo is approved. Refused in production by
 * the env schema (`MODERATION_PROVIDER=dev`).
 * @returns {import('../../ports.js').ModerationProvider}
 */
export function createDevModeration() {
  return { name: 'dev', inspect: async () => ({ labels: [], faces: [] }) };
}
