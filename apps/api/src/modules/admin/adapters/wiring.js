// @ts-check
import { importJWK, SignJWT } from 'jose';
import { makeAdmin } from '../application/admin.js';
import { createAdminCrypto } from './crypto/node-crypto.js';
import { createAdminStores } from './pg/stores.js';

/**
 * Signs admin access tokens: audience `vouch:admin`, `amr` [pwd, otp, mfa], the role, and
 * `ADMIN_TOKEN_TTL_MINUTES` (60), and `sid`, the admin session checked on every request (Phase
 * 14). There is no refresh token: staff sign in again.
 * @param {{ keys: import('../../../platform/config.js').JwtKey[], activeKid: string, ttlMinutes: number, clock: { now: () => Date } }} options
 */
export function createAdminTokenSigner({ keys, activeKid, ttlMinutes, clock }) {
  const active = keys.find((key) => key.kid === activeKid);
  /** @type {Promise<any> | null} */
  let privateKey = null;
  return {
    /** @param {import('../ports.js').StaffMember} staff @param {string} sessionId */
    async sign(staff, sessionId) {
      if (!active?.privateJwk) throw new Error(`no private key for the active kid ${activeKid}`);
      privateKey ??= importJWK(/** @type {import('jose').JWK} */ (active.privateJwk), 'EdDSA');
      const now = clock.now();
      const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
      const token = await new SignJWT({
        amr: ['pwd', 'otp', 'mfa'],
        role: staff.role,
        sid: sessionId,
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: activeKid, typ: 'JWT' })
        .setIssuer('vouch')
        .setAudience('vouch:admin')
        .setSubject(staff.id)
        .setIssuedAt(Math.floor(now.getTime() / 1000))
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(await privateKey);
      return { token, expiresAt };
    },
  };
}

/**
 * @param {any} ctx  Registry context.
 * @returns {import('../ports.js').AdminDeps}
 */
export function buildAdminDeps(ctx) {
  const { config, db, clock, logger } = ctx;
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('admin', createAdminStores),
    read: (fn) => db.read('admin', (/** @type {any} */ tx) => fn(createAdminStores(tx))),
    crypto: createAdminCrypto({
      totpKey: config.ADMIN_TOTP_KEY ? Buffer.from(config.ADMIN_TOTP_KEY, 'base64') : null,
      emailHmacSecret: config.EMAIL_HMAC_SECRET,
    }),
    tokens: createAdminTokenSigner({
      keys: config.jwtKeys,
      activeKid: config.JWT_ACTIVE_KID,
      ttlMinutes: config.ADMIN_TOKEN_TTL_MINUTES,
      clock,
    }),
    rateLimiter: ctx.rateLimiter,
    identity: ctx.deps.identity,
    profiles: ctx.deps.profiles,
    safety: ctx.deps.safety,
    flags: ctx.flags,
    sockets: ctx.sockets,
    panels: ctx.adminPanels,
    subscriptions: ctx.subscriptions,
    settings: { ipAllowlist: config.ADMIN_IP_ALLOWLIST ?? [] },
    clock,
    newId: ctx.newId,
    logger: logger.child({ module: 'admin' }),
  };
}

/** @param {import('../ports.js').AdminDeps} deps */
export const buildAdminHandlers = (deps) => makeAdmin(deps);
