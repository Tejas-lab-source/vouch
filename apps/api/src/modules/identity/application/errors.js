// @ts-check
import { ServiceError } from '@vouch/contracts';

/**
 * Runs a call to Redis-backed state; any failure becomes TEMPORARILY_UNAVAILABLE, so auth flows
 * fail closed with a clear error instead of a 500.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function orUnavailable(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw new ServiceError('TEMPORARILY_UNAVAILABLE', { cause: err });
  }
}
