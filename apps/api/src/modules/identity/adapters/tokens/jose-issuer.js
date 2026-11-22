// @ts-check
import { importJWK, SignJWT } from 'jose';
import { ACCESS_TOKEN_TTL_MS } from '../../domain/session.js';

/**
 * Signs 15-minute EdDSA access tokens with the active key (`JWT_ACTIVE_KID`). Claims: `sub`
 * (the caller's internal user id), `sid` (session id), `iss` vouch, `aud` vouch:user.
 * @param {{ keys: import('../../../../platform/config.js').JwtKey[], activeKid: string, clock: { now: () => Date } }} options
 * @returns {Promise<import('../../ports.js').TokenIssuer>}
 */
export async function createTokenIssuer({ keys, activeKid, clock }) {
  const active = keys.find((key) => key.kid === activeKid);
  if (!active?.privateJwk) {
    throw new Error(
      `JWT_SIGNING_KEYS has no private key for the active kid ${activeKid}; run pnpm dev:keys locally`,
    );
  }
  const privateKey = await importJWK(
    /** @type {import('jose').JWK} */ (active.privateJwk),
    'EdDSA',
  );
  return {
    async issueAccessToken({ userId, sessionId }) {
      const now = clock.now();
      const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
      const token = await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: 'EdDSA', kid: activeKid, typ: 'JWT' })
        .setIssuer('vouch')
        .setAudience('vouch:user')
        .setSubject(userId)
        .setIssuedAt(Math.floor(now.getTime() / 1000))
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(privateKey);
      return { token, expiresAt };
    },
  };
}
