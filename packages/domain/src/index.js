// @ts-check

/** The minimum age to use Vouch (the same rule as the backend's identity domain). */
export const MIN_AGE = 18;

/**
 * Whole years between a birth date and `today` (calendar dates, UTC). Mirrors
 * `apps/api/src/modules/identity/domain/age.js`, so the client refuses what the server would.
 * @param {string} birthDate  `YYYY-MM-DD`
 * @param {Date} today
 */
export function ageOn(birthDate, today) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const years = today.getUTCFullYear() - (y ?? 0);
  const beforeBirthday =
    today.getUTCMonth() + 1 < (m ?? 1) ||
    (today.getUTCMonth() + 1 === (m ?? 1) && today.getUTCDate() < (d ?? 1));
  return beforeBirthday ? years - 1 : years;
}

/** @param {string} birthDate @param {Date} today */
export const isAdult = (birthDate, today) =>
  isIsoDate(birthDate) && ageOn(birthDate, today) >= MIN_AGE;

/** A real calendar date in `YYYY-MM-DD`. @param {string} value */
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A plausible email (the server decides which domains are allowed). @param {string} value */
export const isEmail = (value) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** A six-digit sign-in code. @param {string} value */
export const isOtp = (value) => /^\d{6}$/.test(value);

/**
 * Relative time in English ("now", "5 min", "3 h", "2 d", then a date).
 * @param {Date} at
 * @param {Date} now
 */
export function relativeTime(at, now) {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} d`;
  return at.toISOString().slice(0, 10);
}

/**
 * Compares two `x.y.z` versions (the forced-update check against `minSupportedVersion`).
 * @param {string} a
 * @param {string} b
 * @returns {number} negative, zero or positive
 */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0));
  for (let i = 0; i < 3; i += 1) {
    const diff = (x?.at(i) ?? 0) - (y?.at(i) ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** A badge count: "99+" above 99. @param {number} n */
export const formatCount = (n) => (n > 99 ? '99+' : String(Math.max(0, Math.trunc(n))));
