// @ts-check

/**
 * @typedef {object} Clock
 * @property {() => Date} now
 */

/** The real clock. */
export const systemClock = Object.freeze({ now: () => new Date() });

/**
 * A clock that always returns the same instant, for deterministic tests.
 * @param {Date} at
 * @returns {Clock}
 */
export function fixedClock(at) {
  return Object.freeze({ now: () => new Date(at.getTime()) });
}
