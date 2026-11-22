// @ts-check

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Recency: 1 for someone active now, halving every `halfLifeHours`.
 * @param {Date} lastActiveAt
 * @param {Date} now
 * @param {number} halfLifeHours
 */
export function recencyScore(lastActiveAt, now, halfLifeHours) {
  const hours = Math.max(0, now.getTime() - lastActiveAt.getTime()) / HOUR_MS;
  return 0.5 ** (hours / halfLifeHours);
}

/**
 * Completeness: approved photos out of the maximum (2 is the minimum to be shown at all).
 * @param {number} approvedPhotos
 * @param {number} maxPhotos
 */
export function completenessScore(approvedPhotos, maxPhotos) {
  return Math.min(1, Math.max(0, approvedPhotos / maxPhotos));
}

/**
 * New-user boost: 1 on sign-up, fading linearly to 0 after `days`.
 * @param {Date} createdAt
 * @param {Date} now
 * @param {number} days
 */
export function newUserScore(createdAt, now, days) {
  const age = Math.max(0, now.getTime() - createdAt.getTime()) / DAY_MS;
  return age >= days ? 0 : 1 - age / days;
}

/**
 * Exposure cap: 1 while the candidate has been shown fewer than `cap` times today, else 0.
 * The ranker uses this as a gate: a capped candidate leaves the deck.
 * @param {number} shownToday
 * @param {number} cap
 */
export function exposureScore(shownToday, cap) {
  return shownToday < cap ? 1 : 0;
}

/** @param {Date} now  The day key for exposure counters, `yyyymmdd` (UTC). */
export const dayKey = (now) => now.toISOString().slice(0, 10).replaceAll('-', '');
