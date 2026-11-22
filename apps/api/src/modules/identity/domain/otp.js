// @ts-check

export const OTP_DIGITS = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Formats a random integer in [0, 10^6) as a 6-digit code (leading zeros kept).
 * @param {number} n
 */
export function formatCode(n) {
  return String(n).padStart(OTP_DIGITS, '0');
}

/**
 * Decides what a verification attempt means, given the stored attempt count after this attempt.
 * @param {{ matches: boolean, attemptsAfter: number }} attempt
 * @returns {'valid' | 'invalid' | 'exhausted'}
 */
export function judgeAttempt({ matches, attemptsAfter }) {
  if (matches) return 'valid';
  return attemptsAfter >= OTP_MAX_ATTEMPTS ? 'exhausted' : 'invalid';
}
