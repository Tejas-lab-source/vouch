// @ts-check
import { statusOf } from '@vouch/contracts';
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
});

const MESSAGES_BY_CODE = new Map(Object.entries(DEFAULT_MESSAGES));

/** A failure that maps to the error envelope with a stable code. */
export class AppError extends Error {
  /**
   * @param {AppErrorCodeName} code
   * @param {{ status?: number, message?: string, details?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(code, options = {}) {
    super(options.message ?? MESSAGES_BY_CODE.get(code) ?? code, {
      cause: options.cause,
    });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? statusOf(code);
    this.details = options.details;
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
