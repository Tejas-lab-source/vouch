// @ts-check
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request (or per-job) context carried across async calls, so logs and outbox rows get the
 * right request id and trace id without passing them through every function.
 * @typedef {object} RequestContext
 * @property {string} [requestId]
 * @property {string | null} [traceId]
 * @property {string} [module]
 */

const storage = new AsyncLocalStorage();

/**
 * Runs `fn` with `context` as the current context.
 * @template T
 * @param {RequestContext} context
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithContext(context, fn) {
  return storage.run({ ...getContext(), ...context }, fn);
}

/**
 * Sets the context for the rest of the current async execution (used by Fastify hooks).
 * @param {RequestContext} context
 */
export function enterContext(context) {
  storage.enterWith({ ...getContext(), ...context });
}

/**
 * The current context, or an empty one outside any request or job.
 * @returns {RequestContext}
 */
export function getContext() {
  return storage.getStore() ?? {};
}
