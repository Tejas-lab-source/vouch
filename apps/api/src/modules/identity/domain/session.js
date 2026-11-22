// @ts-check

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
export const ERASURE_DELAY_MS = 30 * 24 * 3600 * 1000;

/**
 * @typedef {object} SessionState
 * @property {Date | null} revokedAt
 * @property {string | null} replacedBy  Set when the token was rotated.
 * @property {Date} expiresAt
 */

/**
 * Classifies a presented refresh token.
 * - `reused`: it was already rotated; someone else may hold the newer token, so the whole
 *   family is revoked.
 * - `revoked`: signed out (logout, device sign-out, ban, deletion); simply invalid.
 * @param {SessionState} session
 * @param {Date} now
 * @returns {'valid' | 'reused' | 'revoked' | 'expired'}
 */
export function judgeRefresh(session, now) {
  if (session.replacedBy !== null) return 'reused';
  if (session.revokedAt !== null) return 'revoked';
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
