// @ts-check
import pino from 'pino';
import { getContext } from './context.js';

/**
 * Paths that must never be logged: credentials, tokens, emails, OTP codes and message bodies.
 * Matching values are replaced with `[redacted]`.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.authorization',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.turnstileToken',
  '*.pushToken',
  '*.email',
  '*.otp',
  '*.body',
  '*.privateJwk',
  'email',
  'body',
  'token',
];

/**
 * Creates the root logger. Every line carries the current request id, trace id and module
 * from the async context.
 * @param {{ level: string, base?: Record<string, unknown>, destination?: import('pino').DestinationStream }} options
 * @returns {import('pino').Logger}
 */
export function createLogger({ level, base = {}, destination }) {
  return pino(
    {
      level,
      base: { service: 'vouch-api', ...base },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin() {
        const { requestId, traceId, module } = getContext();
        return {
          ...(requestId ? { requestId } : {}),
          ...(traceId ? { traceId } : {}),
          ...(module ? { module } : {}),
        };
      },
    },
    destination,
  );
}
