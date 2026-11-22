// @ts-check

export const MINIMUM_AGE = 18;

/**
 * Whole years between a birth date and `today` (both calendar dates, UTC).
 * @param {string} birthDate  `YYYY-MM-DD`
 * @param {Date} today
 * @returns {number}
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
 * True when the person is at least 18 on `today`. Someone whose 18th birthday is today is an
 * adult. (The database enforces the same rule on `identity.users`.)
 * @param {string} birthDate
 * @param {Date} today
 */
export function isAdult(birthDate, today) {
  return ageOn(birthDate, today) >= MINIMUM_AGE;
}
