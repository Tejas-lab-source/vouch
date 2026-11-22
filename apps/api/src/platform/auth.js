// @ts-check
import { errors as joseErrors, importJWK, jwtVerify } from 'jose';
import { AppError } from './errors.js';

export const AUDIENCE = Object.freeze({ USER: 'vouch:user', ADMIN: 'vouch:admin' });
export const ISSUER = 'vouch';
/** A retired key keeps verifying for one access-token lifetime. */
export const RETIRED_KEY_GRACE_MS = 15 * 60 * 1000;

/**
 * @typedef {object} Principal
 * @property {string} userId  The internal user (or admin) id from `sub`.
 * @property {'vouch:user' | 'vouch:admin'} audience
 * @property {boolean} mfa  True when `amr` includes `mfa` (required for admin routes).
 * @property {string | undefined} sessionId  `sid` claim, when present.
 */

/**
 * Verifies access tokens (EdDSA) against the configured keys. Issuance is Phase 5's job; this
 * only checks signature, issuer, audience, expiry and key retirement.
 * @param {{ keys: import('./config.js').JwtKey[], clock: import('./clock.js').Clock }} options
 */
export async function createTokenVerifier({ keys, clock }) {
  /** @type {Map<string, { publicKey: Awaited<ReturnType<typeof importJWK>>, retiredAt: number | null }>} */
  const imported = new Map();
  for (const key of keys) {
    imported.set(key.kid, {
      publicKey: await importJWK(/** @type {import('jose').JWK} */ (key.publicJwk), 'EdDSA'),
      retiredAt: key.retiredAt ? Date.parse(key.retiredAt) : null,
    });
  }

  /** @type {import('jose').JWTVerifyGetKey} */
  const getKey = async (header) => {
    const entry = header.kid ? imported.get(header.kid) : undefined;
    if (!entry) throw new joseErrors.JWKSNoMatchingKey();
    if (
      entry.retiredAt !== null &&
      clock.now().getTime() > entry.retiredAt + RETIRED_KEY_GRACE_MS
    ) {
      throw new joseErrors.JWKSNoMatchingKey();
    }
    return entry.publicKey;
  };

  return {
    /**
     * @param {string} token
     * @param {'vouch:user' | 'vouch:admin'} audience
     * @returns {Promise<Principal>}
     */
    async verify(token, audience) {
      try {
        const { payload } = await jwtVerify(token, getKey, {
          algorithms: ['EdDSA'],
          issuer: ISSUER,
          audience,
          currentDate: clock.now(),
          clockTolerance: 5,
          requiredClaims: ['sub', 'exp'],
        });
        const amr = Array.isArray(payload.amr) ? payload.amr : [];
        return {
          userId: /** @type {string} */ (payload.sub),
          audience,
          mfa: amr.includes('mfa'),
          sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
        };
      } catch (err) {
        throw new AppError('UNAUTHENTICATED', {
          message: 'The access token is invalid or expired.',
          cause: err,
        });
      }
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof createTokenVerifier>>} TokenVerifier */

/**
 * @param {string | undefined} header
 * @returns {string | null}
 */
export function bearerToken(header) {
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/.exec(header ?? '');
  return match ? (match[1] ?? null) : null;
}

/**
 * Fastify hooks for authentication, split in two so the global rate limiter runs between them
 * (ADR 0015): `authenticate` (onRequest) sets `request.user`, or records why the request is
 * not authenticated without rejecting it yet; `enforce` (preHandler) rejects it. A request
 * with a missing or bad token is therefore counted against its client IP before it fails.
 * Admin routes also require MFA and, when configured, an allowlisted client IP.
 * @param {{ verifier: TokenVerifier, adminIpAllowlist?: string[], clientIp?: (request: import('fastify').FastifyRequest) => string }} options
 */
export function authHooks({ verifier, adminIpAllowlist = [], clientIp = (r) => r.ip }) {
  /**
   * @param {import('fastify').FastifyRequest & { user?: Principal | null, authError?: unknown }} request
   */
  const decide = async (request) => {
    const mode =
      /** @type {{ auth?: string }} */ (request.routeOptions.config ?? {}).auth ?? 'public';
    if (mode === 'public') return null;
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      if (mode === 'optional') return null;
      throw new AppError('UNAUTHENTICATED');
    }
    if (mode === 'admin') {
      if (adminIpAllowlist.length > 0 && !adminIpAllowlist.includes(clientIp(request))) {
        throw new AppError('IP_NOT_ALLOWED');
      }
      const principal = await verifier.verify(token, AUDIENCE.ADMIN);
      if (!principal.mfa) throw new AppError('MFA_REQUIRED');
      return principal;
    }
    return verifier.verify(token, AUDIENCE.USER);
  };

  return {
    /** @param {import('fastify').FastifyRequest & { user?: Principal | null, authError?: unknown }} request */
    authenticate: async (request) => {
      request.user = null;
      request.authError = undefined;
      try {
        request.user = await decide(request);
      } catch (error) {
        request.authError = error;
      }
    },
    /** @param {import('fastify').FastifyRequest & { authError?: unknown }} request */
    enforce: async (request) => {
      if (request.authError) throw request.authError;
    },
  };
}
