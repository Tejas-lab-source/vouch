// @ts-check
import { ServiceError, userCreated } from '@vouch/contracts';
import { isAdult } from '../domain/age.js';
import { findCollegeForDomain, normaliseEmail } from '../domain/email.js';
import { judgeAttempt } from '../domain/otp.js';
import { orUnavailable } from './errors.js';
import { startSession, tokenPair } from './sessions.js';

const MINUTE = 60 * 1000;

/**
 * @typedef {object} VerifyInput
 * @property {string} email
 * @property {string} code
 * @property {{ platform: 'ios' | 'android' | 'web', appVersion?: string }} device
 * @property {{ birthDate: string, gradYear?: number, consent: { noticeVersion: string, purposes: string[] } }} [signup]
 */

/**
 * Verifies the code and signs in, creating the account when needed.
 * - Wrong code: counts an attempt; the 5th wrong attempt burns the code.
 * - New email without `signup`: SIGNUP_DETAILS_REQUIRED, without consuming the code or counting
 *   an attempt, so the client can retry with the same code until it expires.
 * - Deleted account still being erased: FORBIDDEN. Banned: ACCOUNT_BANNED.
 * Not replayed through the idempotency store: results hold refresh tokens.
 * @param {import('../ports.js').IdentityDeps} deps
 */
export function makeVerifyOtp(deps) {
  const {
    useCase,
    rateLimiter,
    limits,
    crypto,
    otpStore,
    read,
    uow,
    colleges,
    clock,
    newId,
    tokens,
    privacyNoticeVersion,
  } = deps;
  return useCase(
    'identity.verifyOtp',
    /** @param {VerifyInput} input */
    async (input, ctx) => {
      const normalised = normaliseEmail(input.email);
      if (!normalised) throw new ServiceError('OTP_INVALID');
      await rateLimiter.hit(
        [
          {
            key: `identity:verify:ip:${ctx.ip ?? 'unknown'}`,
            max: limits.verifyIp15m,
            windowMs: 15 * MINUTE,
          },
        ],
        { failClosed: true },
      );
      const emailHmac = crypto.hmacEmail(normalised.address);
      const key = emailHmac.toString('hex');

      const record = await orUnavailable(() => otpStore.get(key));
      if (!record)
        throw new ServiceError('OTP_EXPIRED', {
          message: 'The code has expired. Request a new one.',
        });
      if (!crypto.safeEqual(record.codeHash, crypto.hashCode(emailHmac, input.code))) {
        const attemptsAfter = await orUnavailable(() => otpStore.addFailedAttempt(key));
        if (judgeAttempt({ matches: false, attemptsAfter }) === 'exhausted') {
          await orUnavailable(() => otpStore.consume(key));
          throw new ServiceError('OTP_ATTEMPTS_EXHAUSTED');
        }
        throw new ServiceError('OTP_INVALID');
      }

      const existing = await read((stores) => stores.users.findByEmailHmac(emailHmac));
      if (!existing && !input.signup) throw new ServiceError('SIGNUP_DETAILS_REQUIRED');
      if (!(await orUnavailable(() => otpStore.consume(key))))
        throw new ServiceError('OTP_INVALID');

      if (existing) {
        if (existing.status === 'deleted') {
          throw new ServiceError('FORBIDDEN', { message: 'This account is being deleted.' });
        }
        if (existing.status === 'banned') throw new ServiceError('ACCOUNT_BANNED');
        const session = await uow.run(async ({ stores }) => {
          const deviceId = newId();
          await stores.devices.insert({
            id: deviceId,
            userId: existing.id,
            platform: input.device.platform,
            appVersion: input.device.appVersion ?? null,
            at: clock.now(),
          });
          return startSession(stores, deps, { userId: existing.id, deviceId });
        });
        return {
          tokens: await tokenPair(tokens, { userId: existing.id, ...session }),
          user: { userId: existing.publicId, status: existing.status, newUser: false },
        };
      }

      const signup = /** @type {NonNullable<VerifyInput['signup']>} */ (input.signup);
      if (signup.consent.noticeVersion !== privacyNoticeVersion) {
        throw new ServiceError('VALIDATION_FAILED', {
          message: 'Accept the current privacy notice to continue.',
        });
      }
      const now = clock.now();
      if (!isAdult(signup.birthDate, now)) throw new ServiceError('UNDERAGE');
      const college = findCollegeForDomain(normalised.domain, await colleges.all());
      if (!college) throw new ServiceError('EMAIL_DOMAIN_NOT_ALLOWED');

      const userId = newId();
      const publicId = crypto.randomPublicId();
      const session = await uow.run(async ({ stores, emit }) => {
        await stores.users.insert({
          id: userId,
          publicId,
          collegeId: college.id,
          emailHmac,
          status: 'active',
          birthDate: signup.birthDate,
          gradYear: signup.gradYear ?? null,
          createdAt: now,
        });
        await stores.consents.insert({
          id: newId(),
          userId,
          noticeVersion: signup.consent.noticeVersion,
          purposes: signup.consent.purposes,
          at: now,
        });
        const deviceId = newId();
        await stores.devices.insert({
          id: deviceId,
          userId,
          platform: input.device.platform,
          appVersion: input.device.appVersion ?? null,
          at: now,
        });
        await emit(userCreated, {
          userId,
          publicId,
          collegeId: college.id,
          clusterId: college.clusterId,
          birthDate: signup.birthDate,
          status: 'active',
          createdAt: now.toISOString(),
        });
        return startSession(stores, deps, { userId, deviceId });
      });
      return {
        tokens: await tokenPair(tokens, { userId, ...session }),
        user: { userId: publicId, status: /** @type {const} */ ('active'), newUser: true },
      };
    },
    { authz: 'public' },
  );
}
