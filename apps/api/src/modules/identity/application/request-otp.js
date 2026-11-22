// @ts-check
import { ServiceError } from '@vouch/contracts';
import { findCollegeForDomain, normaliseEmail } from '../domain/email.js';
import { OTP_TTL_MS } from '../domain/otp.js';
import { orUnavailable } from './errors.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Sends a sign-in code. Fails closed: if Redis or the rate limiter is unavailable, nothing is
 * sent and the caller gets TEMPORARILY_UNAVAILABLE. Always answers `{ sent: true }` otherwise,
 * so the endpoint never reveals whether an account exists.
 * @param {import('../ports.js').IdentityDeps} deps
 */
export function makeRequestOtp({
  useCase,
  rateLimiter,
  limits,
  captcha,
  colleges,
  crypto,
  otpStore,
  email,
  idCardFallback,
}) {
  return useCase(
    'identity.requestOtp',
    /** @param {{ email: string, turnstileToken: string, deviceId?: string, verification?: 'college_email' | 'id_card' }} input */
    async (input, ctx) => {
      const normalised = normaliseEmail(input.email);
      if (!normalised)
        throw new ServiceError('VALIDATION_FAILED', { message: 'Enter a valid email address.' });
      const emailHmac = crypto.hmacEmail(normalised.address);
      const key = emailHmac.toString('hex');

      await rateLimiter.hit(
        [
          { key: `identity:otp:email15m:${key}`, max: limits.otpEmail15m, windowMs: 15 * MINUTE },
          { key: `identity:otp:emailDay:${key}`, max: limits.otpEmailDay, windowMs: 24 * HOUR },
          { key: `identity:otp:ip:${ctx.ip ?? 'unknown'}`, max: limits.otpIpHour, windowMs: HOUR },
          ...(input.deviceId
            ? [
                {
                  key: `identity:otp:device:${input.deviceId}`,
                  max: limits.otpDeviceHour,
                  windowMs: HOUR,
                },
              ]
            : []),
        ],
        { failClosed: true },
      );

      if (!(await captcha.verify(input.turnstileToken, ctx.ip ?? '')))
        throw new ServiceError('CAPTCHA_FAILED');
      if (input.verification === 'id_card') {
        // Any email: the account will wait for a reviewed student ID (Phase 10).
        if (!idCardFallback) throw new ServiceError('FEATURE_DISABLED');
      } else if (!findCollegeForDomain(normalised.domain, await colleges.all())) {
        throw new ServiceError('EMAIL_DOMAIN_NOT_ALLOWED');
      }

      const code = crypto.randomCode();
      await orUnavailable(() => otpStore.save(key, crypto.hashCode(emailHmac, code), OTP_TTL_MS));
      await orUnavailable(() => email.sendOtp({ to: normalised.address, code, emailHmac }));
      return { sent: /** @type {const} */ (true) };
    },
    { authz: 'public', idempotent: true },
  );
}
