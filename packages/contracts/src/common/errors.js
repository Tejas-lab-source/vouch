// @ts-check
import { z } from 'zod';

/**
 * Every stable error code with its HTTP status. Codes are additive: never rename or remove one.
 * Socket acks use the same codes inside `{ ok: false, error }`.
 */
export const ERROR_STATUS = Object.freeze({
  // Generic
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  APP_VERSION_UNSUPPORTED: 426,
  RATE_LIMITED: 429,
  FEATURE_DISABLED: 403,
  INTERNAL: 500,
  // Identity
  CAPTCHA_FAILED: 400,
  EMAIL_DOMAIN_NOT_ALLOWED: 422,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_ATTEMPTS_EXHAUSTED: 429,
  SIGNUP_DETAILS_REQUIRED: 422,
  UNDERAGE: 422,
  REFRESH_TOKEN_INVALID: 401,
  REFRESH_TOKEN_REUSED: 401,
  ACCOUNT_BANNED: 403,
  ACCOUNT_PENDING_REVIEW: 403,
  // Profiles and media
  UNKNOWN_SECTION_TYPE: 404,
  PROFILE_INCOMPLETE: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FILE_TOO_LARGE: 413,
  PHOTO_LIMIT_REACHED: 409,
  UPLOAD_NOT_UPLOADED: 409,
  // Matching and safety
  NOT_SERVED: 409,
  NOT_MATCHED: 403,
  BLOCKED: 403,
  // Chat
  CONVERSATION_CLOSED: 409,
  NOT_A_MEMBER: 403,
  MESSAGE_REJECTED: 422,
  // Admin
  MFA_REQUIRED: 401,
  IP_NOT_ALLOWED: 403,
});

/** @typedef {keyof typeof ERROR_STATUS} AppErrorCodeName */

export const AppErrorCode = z.enum(
  /** @type {[AppErrorCodeName, ...AppErrorCodeName[]]} */ (Object.keys(ERROR_STATUS)),
);

/** The body inside the error envelope; also the `error` of a failed socket ack. */
export const ErrorBody = z.strictObject({
  code: AppErrorCode,
  message: z.string().min(1).max(500).describe('Human-readable; never contains PII.'),
  details: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Machine-readable extras, for example the failing field paths.'),
  requestId: z.string().min(1).max(100),
});

/** `{ error: { code, message, details?, requestId } }`, returned for every non-2xx response. */
export const ErrorEnvelope = z.strictObject({ error: ErrorBody });
