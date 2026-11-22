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
 * - `retry`: it was rotated less than `graceMs` ago and its replacement has never been used
 *   (not rotated, not revoked). The client most likely lost the response on a flaky network,
 *   so it gets a fresh pair in the same family instead of being signed out.
 * - `reused`: it was already rotated, outside the grace window or after the replacement was
 *   used; someone else may hold the newer token, so the whole family is revoked.
 * - `revoked`: signed out (logout, device sign-out, ban, deletion); simply invalid.
 *
 * For a rotated token `revokedAt` is the rotation time.
 * @param {SessionState} session
 * @param {Date} now
 * @param {{ replacement?: SessionState | null, graceMs?: number }} [retry]
 * @returns {'valid' | 'retry' | 'reused' | 'revoked' | 'expired'}
 */
export function judgeRefresh(session, now, { replacement = null, graceMs = 0 } = {}) {
  if (session.replacedBy !== null) {
    const rotatedAt = session.revokedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const withinGrace = graceMs > 0 && now.getTime() - rotatedAt <= graceMs;
    const replacementUnused =
      replacement !== null && replacement.replacedBy === null && replacement.revokedAt === null;
    return withinGrace && replacementUnused ? 'retry' : 'reused';
  }
  if (session.revokedAt !== null) return 'revoked';
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
