// @ts-check
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { AUDIENCE } from './auth.js';
import { AppError } from './errors.js';

/**
 * @typedef {object} CallContext
 * @property {import('./auth.js').Principal | null} actor
 * @property {string | undefined} [idempotencyKey]
 * @property {import('./flags.js').FlagSubject} [flagSubject]
 */

/**
 * @typedef {'public' | 'user' | 'admin' | ((ctx: CallContext, input: any) => boolean | Promise<boolean>)} Authz
 */

/**
 * @typedef {object} UseCaseOptions
 * @property {Authz} [authz]  Default `user`.
 * @property {import('zod').ZodType} [input]  Validated before the handler runs.
 * @property {string} [flag]  Feature flag that must be on for the caller.
 * @property {boolean} [idempotent]  Replays the stored result for a repeated idempotency key.
 */

/** @typedef {(input: any, ctx: CallContext) => Promise<any>} Handler */
/** @typedef {(next: Handler) => Handler} Decorator */

/**
 * @param {...Decorator} decorators  Outermost first.
 * @returns {(handler: Handler) => Handler}
 */
export const compose =
  (...decorators) =>
  (handler) =>
    decorators.reduceRight((next, decorate) => decorate(next), handler);

/**
 * Builds the `useCase()` factory with the platform's services. Every use case gets the same
 * chain, outermost first: tracing → metrics → authz → validation → flag → idempotency.
 * A new cross-cutting layer is one more decorator here.
 * @param {{
 *   metrics: import('./metrics.js').Metrics,
 *   flags: Pick<import('./flags.js').Flags, 'isEnabled'>,
 *   idempotency: import('./idempotency.js').IdempotencyStore,
 *   now?: () => number,
 * }} deps
 */
export function createUseCaseFactory({
  metrics,
  flags,
  idempotency,
  now = () => performance.now(),
}) {
  const tracer = trace.getTracer('vouch.usecase');

  /** @param {string} name @returns {Decorator} */
  const withTracing = (name) => (next) => (input, ctx) =>
    tracer.startActiveSpan(`usecase ${name}`, async (span) => {
      try {
        return await next(input, ctx);
      } catch (err) {
        span.recordException(/** @type {Error} */ (err));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });

  /** @param {string} name @returns {Decorator} */
  const withMetrics = (name) => (next) => async (input, ctx) => {
    const started = now();
    try {
      const result = await next(input, ctx);
      metrics.observeUseCase(name, 'ok', (now() - started) / 1000);
      return result;
    } catch (err) {
      metrics.observeUseCase(name, 'error', (now() - started) / 1000);
      throw err;
    }
  };

  /** @param {Authz} authz @returns {Decorator} */
  const withAuthz = (authz) => (next) => async (input, ctx) => {
    if (authz === 'user' && ctx.actor?.audience !== AUDIENCE.USER)
      throw new AppError('UNAUTHENTICATED');
    if (authz === 'admin') {
      if (ctx.actor?.audience !== AUDIENCE.ADMIN) throw new AppError('FORBIDDEN');
      if (!ctx.actor.mfa) throw new AppError('MFA_REQUIRED');
    }
    if (typeof authz === 'function' && !(await authz(ctx, input))) throw new AppError('FORBIDDEN');
    return next(input, ctx);
  };

  /** @param {import('zod').ZodType | undefined} schema @returns {Decorator} */
  const withValidation = (schema) => (next) => async (input, ctx) => {
    if (!schema) return next(input, ctx);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', {
        details: {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    return next(parsed.data, ctx);
  };

  /** @param {string | undefined} flag @returns {Decorator} */
  const withFlag = (flag) => (next) => async (input, ctx) => {
    if (flag && !(await flags.isEnabled(flag, { userId: ctx.actor?.userId, ...ctx.flagSubject }))) {
      throw new AppError('FEATURE_DISABLED');
    }
    return next(input, ctx);
  };

  /** @param {string} name @param {boolean | undefined} idempotent @returns {Decorator} */
  const withIdempotency = (name, idempotent) => (next) => async (input, ctx) => {
    if (!idempotent || !ctx.idempotencyKey) return next(input, ctx);
    const scope = `${name}:${ctx.actor?.userId ?? 'anon'}`;
    return idempotency.run(scope, ctx.idempotencyKey, input, () => next(input, ctx));
  };

  /**
   * Wraps a handler in the standard chain.
   * @param {string} name  `<module>.<useCase>`, for spans, metrics and idempotency scope.
   * @param {Handler} handler
   * @param {UseCaseOptions} [opts]
   * @returns {Handler}
   */
  return function useCase(name, handler, opts = {}) {
    return compose(
      withTracing(name),
      withMetrics(name),
      withAuthz(opts.authz ?? 'user'),
      withValidation(opts.input),
      withFlag(opts.flag),
      withIdempotency(name, opts.idempotent),
    )(handler);
  };
}

/** @typedef {ReturnType<typeof createUseCaseFactory>} UseCaseFactory */
