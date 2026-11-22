// @ts-check
import { makeAccountUseCases } from '../application/account.js';
import { makeDeviceUseCases } from '../application/devices.js';
import { makeRefresh } from '../application/refresh.js';
import { makeRequestOtp } from '../application/request-otp.js';
import { makeUserQueries } from '../application/users.js';
import { makeVerifyOtp } from '../application/verify-otp.js';
import { createDevCaptchaVerifier, createTurnstileVerifier } from './captcha/turnstile.js';
import { createIdentityCrypto } from './crypto/node-crypto.js';
import { createConsoleEmailProvider } from './email/console.js';
import { createResendEmailProvider } from './email/resend.js';
import { createIdentityStores } from './pg/stores.js';
import { createOtpStore } from './redis/otp-store.js';
import { createTokenIssuer } from './tokens/jose-issuer.js';

/**
 * @typedef {object} IdentityOverrides  Test seams: replace external providers.
 * @property {import('../ports.js').EmailProvider} [email]
 * @property {import('../ports.js').CaptchaVerifier} [captcha]
 */

/**
 * Chooses the email provider from config (Resend in production; console in development).
 * @param {import('../../../platform/config.js').Config} config
 * @param {import('pino').Logger} logger
 */
function emailProvider(config, logger) {
  if (config.EMAIL_PROVIDER === 'resend') {
    return createResendEmailProvider({
      apiKey: String(config.RESEND_API_KEY),
      from: String(config.EMAIL_FROM),
    });
  }
  if (config.EMAIL_PROVIDER === 'console') return createConsoleEmailProvider({ logger });
  throw new Error(`EMAIL_PROVIDER ${config.EMAIL_PROVIDER} is not supported by identity`);
}

/**
 * Builds the identity module's dependencies from the platform context.
 * @param {any} ctx  Registry context: platform services, `exporters`, optional `overrides.identity`.
 * @returns {Promise<import('../ports.js').IdentityDeps>}
 */
export async function buildIdentityDeps(ctx) {
  const { config, logger, db, redis, clock } = ctx;
  /** @type {IdentityOverrides} */
  const overrides = ctx.overrides?.identity ?? {};
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('identity', createIdentityStores),
    read: (fn) => db.read('identity', (/** @type {any} */ tx) => fn(createIdentityStores(tx))),
    otpStore: createOtpStore({ redis: redis.command }),
    colleges: {
      all: () =>
        db.read(
          'identity',
          (/** @type {any} */ tx) =>
            tx`SELECT id, cluster_id, email_domains FROM platform.colleges_v`,
        ),
    },
    crypto: createIdentityCrypto({ emailHmacSecret: config.EMAIL_HMAC_SECRET }),
    tokens: await createTokenIssuer({
      keys: config.jwtKeys,
      activeKid: config.JWT_ACTIVE_KID,
      clock,
    }),
    email: overrides.email ?? emailProvider(config, logger),
    captcha:
      overrides.captcha ??
      (config.CAPTCHA_PROVIDER === 'turnstile'
        ? createTurnstileVerifier({ secret: String(config.TURNSTILE_SECRET_KEY) })
        : createDevCaptchaVerifier()),
    rateLimiter: ctx.rateLimiter,
    limits: {
      otpEmail15m: config.RATE_LIMIT_OTP_EMAIL_15M,
      otpEmailDay: config.RATE_LIMIT_OTP_EMAIL_DAY,
      otpIpHour: config.RATE_LIMIT_OTP_IP_HOUR,
      otpDeviceHour: config.RATE_LIMIT_OTP_DEVICE_HOUR,
      verifyIp15m: config.RATE_LIMIT_VERIFY_IP_15M,
      refreshSessionHour: config.RATE_LIMIT_REFRESH_SESSION_HOUR,
      refreshReuseGraceMs: config.REFRESH_REUSE_GRACE_SECONDS * 1000,
    },
    clock,
    newId: ctx.newId,
    privacyNoticeVersion: config.PRIVACY_NOTICE_VERSION,
    exporters: ctx.exporters,
  };
}

/**
 * All identity use cases, wrapped by the platform pipeline.
 * @param {import('../ports.js').IdentityDeps} deps
 */
export function buildIdentityHandlers(deps) {
  return {
    requestOtp: makeRequestOtp(deps),
    verifyOtp: makeVerifyOtp(deps),
    refresh: makeRefresh(deps),
    ...makeDeviceUseCases(deps),
    ...makeAccountUseCases(deps),
    queries: makeUserQueries(deps),
  };
}
