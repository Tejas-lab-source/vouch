// @ts-check
import { ServiceError } from '@vouch/contracts';
import { judgeRefresh } from '../domain/session.js';
import { startSession, tokenPair } from './sessions.js';

const HOUR = 3600 * 1000;

/**
 * Rotates a refresh token: the presented session is replaced by a new one in the same family.
 * Presenting an already-rotated token revokes the whole family (theft detection), except a
 * retry within the grace window whose replacement was never used: that gets a fresh pair in
 * the same family, and the unused replacement is retired (ADR 0011). A revoked token is
 * simply invalid.
 * The token comes from the body (mobile) or the `vouch_refresh` cookie (web).
 * @param {import('../ports.js').IdentityDeps} deps
 */
export function makeRefresh(deps) {
  const { useCase, uow, crypto, clock, tokens, rateLimiter, limits } = deps;
  return useCase(
    'identity.refresh',
    /** @param {{ refreshToken?: string }} input */
    async (input, ctx) => {
      const presented = input.refreshToken ?? ctx.refreshCookie;
      if (!presented) throw new ServiceError('REFRESH_TOKEN_INVALID');
      const now = clock.now();

      const outcome = await uow.run(async ({ stores }) => {
        const session = await stores.sessions.findByTokenHashForUpdate(crypto.hashToken(presented));
        if (!session) return /** @type {const} */ ({ error: 'REFRESH_TOKEN_INVALID' });
        const replacement = session.replacedBy
          ? await stores.sessions.findByIdForUpdate(session.replacedBy)
          : null;
        const verdict = judgeRefresh(session, now, {
          replacement,
          graceMs: limits.refreshReuseGraceMs,
        });
        if (verdict === 'reused') {
          await stores.sessions.revokeFamily(session.familyId, now);
          return /** @type {const} */ ({ error: 'REFRESH_TOKEN_REUSED' });
        }
        if (verdict === 'expired' || verdict === 'revoked') {
          return /** @type {const} */ ({ error: 'REFRESH_TOKEN_INVALID' });
        }

        const user = await stores.users.findById(session.userId);
        if (!user || user.status === 'deleted')
          return /** @type {const} */ ({ error: 'REFRESH_TOKEN_INVALID' });
        if (user.status === 'banned') return /** @type {const} */ ({ error: 'ACCOUNT_BANNED' });

        await rateLimiter.hit([
          {
            key: `identity:refresh:family:${session.familyId}`,
            max: limits.refreshSessionHour,
            windowMs: HOUR,
          },
        ]);
        const next = await startSession(stores, deps, {
          userId: session.userId,
          deviceId: session.deviceId,
          familyId: session.familyId,
        });
        if (verdict === 'retry' && replacement) {
          // The unused replacement is retired as rotated, so presenting it later follows the
          // same rules. The original keeps its rotation time: retries never extend the window.
          await stores.sessions.markRotated(replacement.id, next.sessionId, now);
          await stores.sessions.markRotated(session.id, next.sessionId, session.revokedAt ?? now);
        } else {
          await stores.sessions.markRotated(session.id, next.sessionId, now);
        }
        await stores.devices.touch(session.deviceId, now);
        return { userId: session.userId, ...next };
      });

      // Revocations above are committed before the error is raised.
      if ('error' in outcome) {
        throw new ServiceError(
          /** @type {'REFRESH_TOKEN_INVALID' | 'REFRESH_TOKEN_REUSED' | 'ACCOUNT_BANNED'} */ (
            outcome.error
          ),
        );
      }
      return { tokens: await tokenPair(tokens, outcome) };
    },
    { authz: 'public' },
  );
}
