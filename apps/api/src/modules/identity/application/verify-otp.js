// @ts-check
import { ServiceError, userCreated } from '@vouch/contracts';
import { isAdult } from '../domain/age.js';
import { findCollegeForDomain, normaliseEmail } from '../domain/email.js';
import { normaliseInviteCode } from '../domain/invite.js';
import { judgeAttempt } from '../domain/otp.js';
import { orUnavailable } from './errors.js';
import { startSession, tokenPair } from './sessions.js';

const MINUTE = 60 * 1000;

/**
 * @typedef {object} VerifyInput
 * @property {string} email
 * @property {string} code
 * @property {{ platform: 'ios' | 'android' | 'web', appVersion?: string }} device
 * @property {{ birthDate: string, gradYear?: number, collegeId?: string, inviteCode?: string, consent: { noticeVersion: string, purposes: string[] } }} [signup]
 * @property {'college_email' | 'id_card'} [verification]
 */

/**
 * @typedef {object} Admission
 * @property {import('../ports.js').College} college
 * @property {boolean} viaIdCard
 * @property {Buffer | null} inviteHash  Set when the college is invite-only.
 */

/**
 * Verifies the code and signs in, creating the account when needed.
 * - Wrong code: counts an attempt; the 5th wrong attempt burns the code.
 * - New email without `signup`: SIGNUP_DETAILS_REQUIRED, without consuming the code or counting
 *   an attempt, so the client can retry with the same code until it expires.
 * - Deleted account still being erased: FORBIDDEN. Banned: ACCOUNT_BANNED, also for a new
 *   sign-up whose email belongs to an erased account that is still banned (Phase 10).
 * - ID-card sign-up (`verification: 'id_card'`, any email, `signup.collegeId`): the account is
 *   created `pending_review` until staff approve the student ID and selfie (Phase 10).
 * - Invite-only college (Phase 15): a new sign-up needs a usable `signup.inviteCode`
 *   (INVITE_CODE_REQUIRED / INVITE_CODE_INVALID). The college and the invite are checked before
 *   the code is consumed, so the client can retry with the same code; the invite's use is
 *   counted in the sign-up transaction.
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
    idCardFallback,
    inviteOnly,
  } = deps;
  /**
   * The college a new account joins, and the hashed invite when the college is invite-only.
   * @param {string} domain
   * @param {VerifyInput} input
   * @returns {Promise<Admission>}
   */
  const admit = async (domain, input) => {
    const signup = /** @type {NonNullable<VerifyInput['signup']>} */ (input.signup);
    const all = await colleges.all();
    const byDomain = findCollegeForDomain(domain, all);
    const viaIdCard = !byDomain && input.verification === 'id_card';
    if (viaIdCard && !idCardFallback) throw new ServiceError('FEATURE_DISABLED');
    const college =
      byDomain ?? (viaIdCard ? all.find((c) => c.id === signup.collegeId) : undefined);
    if (!college) {
      if (viaIdCard) {
        throw new ServiceError('VALIDATION_FAILED', { message: 'Choose your college.' });
      }
      throw new ServiceError('EMAIL_DOMAIN_NOT_ALLOWED');
    }
    if (!(await inviteOnly(college.id))) return { college, viaIdCard, inviteHash: null };
    if (!signup.inviteCode) throw new ServiceError('INVITE_CODE_REQUIRED');
    const normalisedCode = normaliseInviteCode(signup.inviteCode);
    const inviteHash = normalisedCode ? crypto.hashToken(normalisedCode) : null;
    const usable =
      inviteHash &&
      (await read((stores) => stores.inviteCodes.findUsable(inviteHash, college.id, clock.now())));
    if (!inviteHash || !usable) throw new ServiceError('INVITE_CODE_INVALID');
    return { college, viaIdCard, inviteHash };
  };

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
      if (!existing) {
        // Only the email owner (who knows the code) learns this.
        const banned = await read((stores) => stores.bannedEmails.isBanned(emailHmac, clock.now()));
        if (banned) {
          await orUnavailable(() => otpStore.consume(key));
          throw new ServiceError('ACCOUNT_BANNED');
        }
      }
      if (!existing && !input.signup) throw new ServiceError('SIGNUP_DETAILS_REQUIRED');
      // A new account: its college and, if the college is invite-only, the invite, both
      // checked before the code is used up.
      const admission = existing ? null : await admit(normalised.domain, input);
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
          tokens: await tokenPair(tokens, {
            userId: existing.id,
            ...session,
            pendingReview: existing.status === 'pending_review',
          }),
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
      const { college, viaIdCard, inviteHash } = /** @type {Admission} */ (admission);
      /** @type {'active' | 'pending_review'} */
      const status = viaIdCard ? 'pending_review' : 'active';

      const userId = newId();
      const publicId = crypto.randomPublicId();
      const session = await uow.run(async ({ stores, emit }) => {
        const inviteCodeId = inviteHash
          ? await stores.inviteCodes.redeem(inviteHash, college.id, now)
          : null;
        // Used up or expired since the check above (a race for the last use).
        if (inviteHash && !inviteCodeId) throw new ServiceError('INVITE_CODE_INVALID');
        await stores.users.insert({
          id: userId,
          publicId,
          collegeId: college.id,
          emailHmac,
          status,
          birthDate: signup.birthDate,
          gradYear: signup.gradYear ?? null,
          createdAt: now,
          inviteCodeId,
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
          status,
          createdAt: now.toISOString(),
        });
        return startSession(stores, deps, { userId, deviceId });
      });
      return {
        tokens: await tokenPair(tokens, {
          userId,
          ...session,
          pendingReview: status === 'pending_review',
        }),
        user: { userId: publicId, status, newUser: true },
      };
    },
    { authz: 'public' },
  );
}
