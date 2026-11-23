// @ts-check

/**
 * The product analytics events (docs/analytics.md). Properties are small enums and counts only:
 * never names, emails, ids of other people, photos or message text.
 */
export const ANALYTICS_EVENTS = Object.freeze([
  'onboarding_step_completed', // { step }
  'onboarding_completed',
  'deck_viewed', // { cards }
  'swipe', // { direction }
  'match', // { source: 'swipe' | 'socket' }
]);

/**
 * @typedef {(typeof ANALYTICS_EVENTS)[number]} AnalyticsEvent
 * @typedef {Record<string, string | number | boolean>} AnalyticsProps
 * @typedef {object} Analytics
 * @property {(event: AnalyticsEvent, props?: AnalyticsProps) => void} track
 */

/** Values allowed per property, so nothing free-form (and nothing personal) is ever recorded. */
const ALLOWED = new Map([
  ['step', new Set(['basics', 'interestedIn', 'ageRange', 'photos'])],
  ['direction', new Set(['like', 'pass'])],
  ['source', new Set(['swipe', 'socket'])],
]);
const NUMERIC = new Set(['cards']);

/**
 * Drops any property that is not on the allow-list.
 * @param {AnalyticsProps} props
 * @returns {AnalyticsProps}
 */
export function sanitizeProps(props) {
  return Object.fromEntries(
    Object.entries(props).filter(([key, value]) =>
      NUMERIC.has(key)
        ? typeof value === 'number' && Number.isFinite(value)
        : ALLOWED.get(key)?.has(String(value)) === true,
    ),
  );
}

/**
 * The v1 adapter: it only logs (no endpoint, no third-party SDK; roadmap Phase 12).
 * @param {(line: string) => void} log  Where lines go (the app's debug log).
 * @returns {Analytics}
 */
export function createLogAnalytics(log) {
  return {
    track(event, props = {}) {
      if (!ANALYTICS_EVENTS.includes(event)) return;
      log(`[analytics] ${event} ${JSON.stringify(sanitizeProps(props))}`);
    },
  };
}

/** @type {Analytics} */
export const noAnalytics = Object.freeze({ track: () => {} });
