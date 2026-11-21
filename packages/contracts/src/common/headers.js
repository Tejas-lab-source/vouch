// @ts-check
import { z } from 'zod';

/** Semantic version `MAJOR.MINOR.PATCH`. */
export const SemVer = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/);

/** `X-App-Version`, sent on every request; old builds are told to update. */
export const AppVersionHeader = SemVer.describe('Client app version, for example 1.4.0.');

/**
 * `Idempotency-Key`, required on every POST unless the body carries a client id instead
 * (for example `swipeId`). A repeated key returns the stored result for 24 hours.
 */
export const IdempotencyKeyHeader = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/)
  .describe('Client-generated key, typically a UUID; reused only for retries of one request.');

/** Headers every request carries. */
export const BaseHeaders = z.object({ 'x-app-version': AppVersionHeader });

/** Headers for POST requests that use the Idempotency-Key header. */
export const IdempotentHeaders = z.object({
  'x-app-version': AppVersionHeader,
  'idempotency-key': IdempotencyKeyHeader,
});
