// @ts-check
import { REFRESH_TOKEN_TTL_MS } from '../domain/session.js';

/**
 * Creates a session (one refresh token) for a device, inside the caller's transaction.
 * @param {import('../ports.js').IdentityStores} stores
 * @param {Pick<import('../ports.js').IdentityDeps, 'crypto' | 'newId' | 'clock'>} deps
 * @param {{ userId: string, deviceId: string, familyId?: string }} session
 * @returns {Promise<{ sessionId: string, refreshToken: string, refreshTokenExpiresAt: Date }>}
 */
export async function startSession(
  stores,
  { crypto, newId, clock },
  { userId, deviceId, familyId },
) {
  const now = clock.now();
  const sessionId = newId();
  const refreshToken = crypto.randomToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
  await stores.sessions.insert({
    id: sessionId,
    userId,
    deviceId,
    familyId: familyId ?? newId(),
    tokenHash: crypto.hashToken(refreshToken),
    createdAt: now,
    expiresAt,
  });
  return { sessionId, refreshToken, refreshTokenExpiresAt: expiresAt };
}

/**
 * The token pair returned to clients. `refreshToken` is removed by the route for cookie transport.
 * @param {import('../ports.js').TokenIssuer} tokens
 * `pendingReview` (Phase 10) marks the access token of an account waiting for ID-card review:
 * the platform then allows only the routes such an account may use.
 * @param {{ userId: string, sessionId: string, refreshToken: string, refreshTokenExpiresAt: Date, pendingReview?: boolean }} session
 */
export async function tokenPair(
  tokens,
  { userId, sessionId, refreshToken, refreshTokenExpiresAt, pendingReview = false },
) {
  const access = await tokens.issueAccessToken({ userId, sessionId, pendingReview });
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  };
}
