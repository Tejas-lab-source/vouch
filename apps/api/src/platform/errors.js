// @ts-check
import { ServiceError, statusOf } from '@vouch/contracts';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { getContext } from './context.js';

/** @typedef {import('@vouch/contracts').AppErrorCodeName} AppErrorCodeName */

/** Messages shown to clients for each error class; never derived from internal error text. */
const DEFAULT_MESSAGES = /** @type {const} */ ({
  VALIDATION_FAILED: 'The request is invalid.',
  UNAUTHENTICATED: 'Sign in to continue.',
  FORBIDDEN: 'You are not allowed to do this.',
  NOT_FOUND: 'Not found.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  INTERNAL: 'Something went wrong.',
  TEMPORARILY_UNAVAILABLE: 'The service is temporarily unavailable. Try again shortly.',
  IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used for a different request.',
  APP_VERSION_UNSUPPORTED: 'Update the app to continue.',
  FEATURE_DISABLED: 'This feature is not available yet.',
  CAPTCHA_FAILED: 'The security check failed. Try again.',
  EMAIL_DOMAIN_NOT_ALLOWED: 'Use the email address your college gave you.',
  OTP_INVALID: 'That code is not right.',
  OTP_EXPIRED: 'The code has expired. Request a new one.',
  OTP_ATTEMPTS_EXHAUSTED: 'Too many wrong codes. Request a new one.',
  SIGNUP_DETAILS_REQUIRED:
    'Add your date of birth and accept the privacy notice to finish signing up.',
  UNDERAGE: 'You must be 18 or older to use Vouch.',
  REFRESH_TOKEN_INVALID: 'Your session has ended. Sign in again.',
  REFRESH_TOKEN_REUSED: 'Your session has ended. Sign in again.',
  ACCOUNT_BANNED: 'This account has been suspended.',
  CONFLICT: 'This conflicts with the current state. Refresh and try again.',
  ACCOUNT_PENDING_REVIEW: 'Your account is being reviewed. We will let you know soon.',
  UNKNOWN_SECTION_TYPE: 'This profile section is not available.',
  PROFILE_INCOMPLETE: 'Finish your profile first.',
  UNSUPPORTED_MEDIA_TYPE: 'Upload a JPEG, PNG or WebP image.',
  FILE_TOO_LARGE: 'This file is too large.',
  PHOTO_LIMIT_REACHED: 'You have reached the photo limit. Remove one to add another.',
  UPLOAD_NOT_UPLOADED: 'The upload did not finish. Try uploading again.',
  NOT_SERVED: 'Swipe on people from your deck.',
  NOT_MATCHED: 'This match has ended.',
  BLOCKED: 'This action is not available.',
  CONVERSATION_CLOSED: 'This conversation has ended.',
  NOT_A_MEMBER: 'You are not part of this conversation.',
  MESSAGE_REJECTED: 'This message could not be sent.',
  MFA_REQUIRED: 'Two-factor authentication is required.',
  IP_NOT_ALLOWED: 'Access from this network is not allowed.',
});

const MESSAGES_BY_CODE = new Map(Object.entries(DEFAULT_MESSAGES));

/** A failure that maps to the error envelope with a stable code (the kernel's ServiceError). */
export class AppError extends ServiceError {
  /**
   * @param {AppErrorCodeName} code
   * @param {{ status?: number, message?: string, details?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(code, options = {}) {
    super(code, {
      message: options.message ?? MESSAGES_BY_CODE.get(code) ?? code,
      details: options.details,
      cause: options.cause,
    });
    this.name = 'AppError';
    this.status = options.status ?? statusOf(code);
  }
}

/**
 * The error envelope body for any thrown value. Unknown errors become INTERNAL with a generic
 * message, so stack traces and internal messages never reach clients.
 * @param {unknown} error
 * @param {string} requestId
 * @returns {{ status: number, body: { error: { code: string, message: string, details?: Record<string, unknown>, requestId: string } } }}
 */
export function toErrorResponse(error, requestId) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: DEFAULT_MESSAGES.INTERNAL, requestId } },
  };
}

/**
 * Converts framework errors (validation, rate limit, malformed JSON, 404) into AppErrors.
 * @param {any} error
 * @returns {unknown}
 */
export function normaliseError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof ServiceError) {
    const custom = error.message !== error.code ? error.message : undefined;
    return new AppError(error.code, { message: custom, details: error.details, cause: error });
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    return new AppError('VALIDATION_FAILED', {
      details: {
        issues: error.validation.map((/** @type {any} */ v) => ({
          path: v.instancePath || v.params?.issue?.path?.join('.') || '',
          message: v.message,
        })),
        context: error.validationContext,
      },
    });
  }
  if (error?.statusCode === 429) return new AppError('RATE_LIMITED');
  if (error?.statusCode === 400 && error?.code?.startsWith?.('FST_ERR_CTP')) {
    return new AppError('VALIDATION_FAILED', { message: 'The request body is not valid JSON.' });
  }
  if (error?.statusCode === 413)
    return new AppError('VALIDATION_FAILED', { message: 'The request body is too large.' });
  if (error?.statusCode === 415) {
    return new AppError('UNSUPPORTED_MEDIA_TYPE', {
      message: 'Send the request body as application/json.',
    });
  }
  // Any other client error raised by Fastify itself is the caller's fault, never a 500.
  if (error?.code?.startsWith?.('FST_ERR') && error.statusCode >= 400 && error.statusCode < 500) {
    return new AppError('VALIDATION_FAILED');
  }
  return error;
}

/**
 * Fastify error handler: maps every error to the envelope; logs 5xx with the error.
 * @param {(error: unknown) => void} [report]  Called for 5xx errors (Sentry).
 * @returns {(error: unknown, request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => void}
 */
export function createErrorHandler(report = () => {}) {
  return (error, request, reply) => {
    const normalised = normaliseError(error);
    const requestId = getContext().requestId ?? request.id;
    const { status, body } = toErrorResponse(normalised, requestId);
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      report(error);
    } else {
      request.log.info({ code: body.error.code, status }, 'request rejected');
    }
    reply.code(status).type('application/json').send(body);
  };
}

/**
 * Fastify not-found handler with the standard envelope.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export function notFoundHandler(request, reply) {
  const { body } = toErrorResponse(new AppError('NOT_FOUND'), request.id);
  reply.code(404).type('application/json').send(body);
}
