// @ts-check
import { z } from 'zod';
import { Platform } from '../common/codes.js';
import { CollegeId, IsoDate, PublicUserId, Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEndpoint, EmptyBody } from './endpoint.js';

const Email = z.email().max(254).describe('College email address; never stored in clear.');
const OtpCode = z
  .string()
  .regex(/^\d{6}$/)
  .describe('6-digit code from the email; valid 10 minutes, 5 attempts.');

/**
 * Where the refresh token travels. `body`: returned in the JSON body (mobile).
 * `cookie`: set as an httpOnly cookie named `vouch_refresh` with `Secure`,
 * `SameSite=Strict` and `Path=/v1/auth/refresh`, and omitted from the body (web).
 * Finalised by the Phase 5 token-strategy ADR.
 */
const TokenTransport = z.enum(['body', 'cookie']).default('body');

const Consent = z.strictObject({
  noticeVersion: z
    .string()
    .min(1)
    .max(40)
    .describe('Version of the privacy notice the user accepted.'),
  purposes: z
    .array(z.string().regex(/^[a-z][a-z_]{0,39}$/))
    .min(1)
    .max(20),
});

/** Sign-up details, needed only when the email has no account yet. */
const SignupDetails = z.strictObject({
  birthDate: IsoDate.describe('Must make the user at least 18 today; otherwise UNDERAGE.'),
  gradYear: z.int().min(2000).max(2100).optional(),
  consent: Consent,
  collegeId: CollegeId.optional().describe(
    'Required for an ID-card sign-up (any email); ignored for a college email.',
  ),
  inviteCode: z
    .string()
    .min(16)
    .max(24)
    .regex(/^[A-Za-z0-9 -]+$/)
    .optional()
    .describe(
      'Phase 15. Required when the college is invite-only (INVITE_CODE_REQUIRED); checked ' +
        'before the code is used up, so the client retries with the same OTP. Case and ' +
        'hyphens do not matter.',
    ),
});

/**
 * How the student proves enrolment. `id_card` (Phase 10) accepts any email; the account stays
 * `pending_review` until staff approve a student ID and a selfie.
 */
const VerificationMethod = z
  .enum(['college_email', 'id_card'])
  .describe('Omitted means college_email.');

const DeviceInfo = z.strictObject({
  platform: Platform,
  appVersion: z.string().max(40).optional(),
});

/** Access token plus (in `body` transport) the rotated refresh token. */
const TokenPair = z.strictObject({
  accessToken: z.string().min(1).describe('EdDSA JWT, 15 minutes.'),
  accessTokenExpiresAt: Timestamp,
  refreshToken: z.string().min(1).optional().describe('Present only with tokenTransport `body`.'),
  refreshTokenExpiresAt: Timestamp.describe('30 days; rotated on every use.'),
});

export const requestOtp = defineEndpoint({
  id: 'requestOtp',
  module: 'identity',
  method: 'POST',
  path: '/v1/auth/otp',
  auth: 'public',
  summary: 'Send a sign-in code to a college email.',
  description:
    'Always answers `{ sent: true }` for an allowed domain, whether or not an account exists, ' +
    'so the endpoint cannot be used to discover accounts. Rate-limited per email, IP and device.',
  body: z.strictObject({
    email: Email,
    turnstileToken: z.string().min(1).max(2048),
    deviceId: z
      .uuid()
      .optional()
      .describe('Client-generated install id, for per-device rate limits.'),
    verification: VerificationMethod.optional(),
  }),
  response: { status: 200, schema: z.strictObject({ sent: z.literal(true) }) },
  errors: [
    'CAPTCHA_FAILED',
    'EMAIL_DOMAIN_NOT_ALLOWED',
    'FEATURE_DISABLED',
    'TEMPORARILY_UNAVAILABLE',
  ],
});

export const verifyOtp = defineEndpoint({
  id: 'verifyOtp',
  module: 'identity',
  method: 'POST',
  path: '/v1/auth/verify',
  auth: 'public',
  summary: 'Verify the code and sign in, creating the account when needed.',
  description:
    'When the email has no account and `signup` is missing, the response is ' +
    '`SIGNUP_DETAILS_REQUIRED` (only after a correct code, so only the email owner learns it). ' +
    'In that case the code is NOT consumed and does NOT count as a failed attempt: the client ' +
    'calls verify again with the same code plus `signup` until the code expires. ' +
    '`signup` is ignored for existing accounts.',
  body: z.strictObject({
    email: Email,
    code: OtpCode,
    device: DeviceInfo,
    tokenTransport: TokenTransport,
    signup: SignupDetails.optional(),
    verification: VerificationMethod.optional(),
  }),
  response: {
    status: 200,
    schema: z.strictObject({
      tokens: TokenPair,
      user: z.strictObject({
        userId: PublicUserId,
        status: z.enum(['pending', 'pending_review', 'active']),
        newUser: z.boolean(),
      }),
    }),
  },
  errors: [
    'OTP_INVALID',
    'OTP_EXPIRED',
    'OTP_ATTEMPTS_EXHAUSTED',
    'SIGNUP_DETAILS_REQUIRED',
    'UNDERAGE',
    'ACCOUNT_BANNED',
    'FORBIDDEN',
    'TEMPORARILY_UNAVAILABLE',
    'INVITE_CODE_REQUIRED',
    'INVITE_CODE_INVALID',
  ],
});

export const refreshTokens = defineEndpoint({
  id: 'refreshTokens',
  module: 'identity',
  method: 'POST',
  path: '/v1/auth/refresh',
  auth: 'public',
  summary: 'Rotate the refresh token and issue a new access token.',
  description:
    'The refresh token comes from the body (mobile) or the `vouch_refresh` httpOnly cookie ' +
    '(web; `Secure`, `SameSite=Strict`, `Path=/v1/auth/refresh`). Reusing a rotated token ' +
    'revokes the whole token family and returns REFRESH_TOKEN_REUSED.',
  body: z.strictObject({
    refreshToken: z.string().min(1).optional().describe('Omit when the cookie carries it.'),
    tokenTransport: TokenTransport,
  }),
  response: { status: 200, schema: z.strictObject({ tokens: TokenPair }) },
  errors: [
    'REFRESH_TOKEN_INVALID',
    'REFRESH_TOKEN_REUSED',
    'ACCOUNT_BANNED',
    'TEMPORARILY_UNAVAILABLE',
  ],
});

export const deleteAccount = defineEndpoint({
  id: 'deleteAccount',
  module: 'identity',
  method: 'DELETE',
  path: '/v1/me',
  auth: 'user',
  summary: 'Delete the account: sign out everywhere and erase data within 30 days.',
  description: 'Idempotent: deleting an already-deleted account returns the same result.',
  response: {
    status: 202,
    schema: z.strictObject({ deleted: z.literal(true), erasureDueBy: Timestamp }),
  },
});

export const exportData = defineEndpoint({
  id: 'exportData',
  module: 'identity',
  method: 'GET',
  path: '/v1/me/export',
  auth: 'user',
  summary: 'Export the personal data every module holds about the user (DPDP access right).',
  description:
    'Each module contributes one entry under `data`, keyed by module name, through the ' +
    '`exports` manifest hook. Entry shapes are module-owned, so they are free-form here.',
  response: {
    status: 200,
    schema: z.strictObject({
      generatedAt: Timestamp,
      data: z.record(z.string().regex(/^[a-z]+$/), z.record(z.string(), z.unknown())),
    }),
  },
});

export const registerDevice = defineEndpoint({
  id: 'registerDevice',
  module: 'identity',
  method: 'POST',
  path: '/v1/devices',
  auth: 'user',
  summary: "Register or replace the current device's push token.",
  body: z.strictObject({
    pushToken: z.string().min(1).max(200).describe('Expo push token.'),
    platform: Platform,
  }),
  response: { status: 200, schema: z.strictObject({ registered: z.literal(true) }) },
});

export const logout = defineEndpoint({
  id: 'logout',
  module: 'identity',
  method: 'POST',
  path: '/v1/auth/logout',
  auth: 'user',
  summary: 'Sign out this device: revokes the current session and its refresh-token family.',
  description: 'Idempotent: logging out an already-revoked session returns the same result.',
  body: EmptyBody,
  response: { status: 200, schema: z.strictObject({ loggedOut: z.literal(true) }) },
});

/** A signed-in device, as the owner sees it. */
export const DeviceSummary = z.strictObject({
  id: Uuidv7.describe('Device id (UUIDv7); only ever shown to its owner.'),
  platform: Platform,
  appVersion: z.string().max(40).nullable(),
  createdAt: Timestamp,
  lastSeenAt: Timestamp,
  current: z.boolean().describe('True for the device making this request.'),
});

export const listDevices = defineEndpoint({
  id: 'listDevices',
  module: 'identity',
  method: 'GET',
  path: '/v1/me/devices',
  auth: 'user',
  summary: 'List the devices signed in to this account.',
  response: { status: 200, schema: z.strictObject({ items: z.array(DeviceSummary).max(50) }) },
});

export const revokeDevice = defineEndpoint({
  id: 'revokeDevice',
  module: 'identity',
  method: 'DELETE',
  path: '/v1/me/devices/{id}',
  auth: 'user',
  summary: 'Sign out one device remotely: revokes its sessions and push token.',
  description: 'Idempotent: revoking an already-revoked device returns the same result.',
  params: z.strictObject({ id: Uuidv7 }),
  response: { status: 200, schema: z.strictObject({ revoked: z.literal(true) }) },
  errors: ['NOT_FOUND'],
});

export const identityEndpoints = [
  requestOtp,
  verifyOtp,
  refreshTokens,
  deleteAccount,
  exportData,
  registerDevice,
  logout,
  listDevices,
  revokeDevice,
];
