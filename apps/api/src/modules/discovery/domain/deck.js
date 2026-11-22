// @ts-check

/** Deck sizes (roadmap Phase 7, ARCHITECTURE.md 8.5). */
export const DECK = Object.freeze({
  /** Candidates read from the published views per build. */
  candidateLimit: 500,
  /** Ranked ids stored per deck. */
  size: 50,
  /** Cards per `GET /v1/deck` page. */
  page: 10,
  /** A refill is queued when fewer remain. */
  refillBelow: 20,
  /** Decks and served sets expire after 24 hours. */
  ttlSeconds: 24 * 3600,
  /** Diversification applies to the first slots. */
  diversifySlots: 10,
});

/**
 * Whole years between a birth date and `today` (calendar dates, UTC).
 * @param {string} birthDate  `YYYY-MM-DD`
 * @param {Date} today
 */
export function ageOn(birthDate, today) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const years = today.getUTCFullYear() - (y ?? 0);
  const beforeBirthday =
    today.getUTCMonth() + 1 < (m ?? 1) ||
    (today.getUTCMonth() + 1 === m && today.getUTCDate() < (d ?? 1));
  return beforeBirthday ? years - 1 : years;
}

/**
 * Whether two people want each other: each one's gender is in the other's interests, and each
 * one's age is in the other's range.
 *
 * @typedef {{ gender: number, interestedIn: readonly number[], age: number, minAge: number, maxAge: number }} Preferences
 */

/**
 * @param {Preferences} a
 * @param {Preferences} b
 */
export function mutuallyInterested(a, b) {
  const wants = (/** @type {Preferences} */ x, /** @type {Preferences} */ y) =>
    x.interestedIn.includes(y.gender) && y.age >= x.minAge && y.age <= x.maxAge;
  return wants(a, b) && wants(b, a);
}
