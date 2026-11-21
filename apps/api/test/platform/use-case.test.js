// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/platform/errors.js';
import { createMetrics } from '../../src/platform/metrics.js';
import { compose, createUseCaseFactory } from '../../src/platform/use-case.js';

const user = {
  userId: 'u1',
  audience: /** @type {const} */ ('vouch:user'),
  mfa: false,
  sessionId: undefined,
};
const admin = {
  userId: 'a1',
  audience: /** @type {const} */ ('vouch:admin'),
  mfa: true,
  sessionId: undefined,
};

function factory({ enabled = true } = {}) {
  const flags = { isEnabled: vi.fn(async () => enabled) };
  const idempotency = { run: vi.fn(async (_scope, _key, _input, fn) => fn()) };
  const metrics = createMetrics();
  return {
    useCase: createUseCaseFactory({ metrics, flags, idempotency }),
    flags,
    idempotency,
    metrics,
  };
}

describe('compose', () => {
  it('applies decorators outermost first', async () => {
    /** @type {string[]} */
    const calls = [];
    /** @param {string} name */
    const tag =
      (name) => (/** @type {any} */ next) => async (/** @type {any} */ i, /** @type {any} */ c) => {
        calls.push(name);
        return next(i, c);
      };
    await compose(tag('a'), tag('b'))(async () => calls.push('handler'))({}, { actor: null });
    expect(calls).toEqual(['a', 'b', 'handler']);
  });
});

describe('useCase', () => {
  it('requires a user token by default', async () => {
    const { useCase } = factory();
    const run = useCase('demo.thing', async () => 'ok');
    await expect(run({}, { actor: null })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(run({}, { actor: admin })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await run({}, { actor: user })).toBe('ok');
  });

  it('admin use cases require the admin audience and MFA', async () => {
    const { useCase } = factory();
    const run = useCase('demo.admin', async () => 'ok', { authz: 'admin' });
    await expect(run({}, { actor: user })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run({}, { actor: { ...admin, mfa: false } })).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
    });
    expect(await run({}, { actor: admin })).toBe('ok');
  });

  it('supports custom authorisation and public use cases', async () => {
    const { useCase } = factory();
    const own = useCase('demo.own', async () => 'ok', {
      authz: (ctx, input) => ctx.actor?.userId === input.owner,
    });
    await expect(own({ owner: 'someone-else' }, { actor: user })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await own({ owner: 'u1' }, { actor: user })).toBe('ok');
    expect(
      await useCase('demo.public', async () => 'ok', { authz: 'public' })({}, { actor: null }),
    ).toBe('ok');
  });

  it('validates input with zod and passes the parsed value on', async () => {
    const { useCase } = factory();
    const run = useCase('demo.validate', async (input) => input, {
      authz: 'public',
      input: z.object({ n: z.coerce.number() }),
    });
    expect(await run({ n: '4' }, { actor: null })).toEqual({ n: 4 });
    await expect(run({ n: 'x' }, { actor: null })).rejects.toBeInstanceOf(AppError);
    await expect(run({ n: 'x' }, { actor: null })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('gates on a feature flag for the caller', async () => {
    const { useCase, flags } = factory({ enabled: false });
    const run = useCase('demo.flagged', async () => 'ok', { flag: 'demo.enabled' });
    await expect(run({}, { actor: user, flagSubject: { platform: 'ios' } })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(flags.isEnabled).toHaveBeenCalledWith('demo.enabled', { userId: 'u1', platform: 'ios' });
  });

  it('uses the idempotency store only when idempotent and a key is given, scoped per caller', async () => {
    const { useCase, idempotency } = factory();
    const run = useCase('demo.write', async () => 'ok', { idempotent: true });
    await run({ a: 1 }, { actor: user });
    expect(idempotency.run).not.toHaveBeenCalled();
    await run({ a: 1 }, { actor: user, idempotencyKey: 'key-12345' });
    expect(idempotency.run).toHaveBeenCalledWith(
      'demo.write:u1',
      'key-12345',
      { a: 1 },
      expect.any(Function),
    );
  });

  it('records duration metrics for successes and failures', async () => {
    const { useCase, metrics } = factory();
    await useCase('demo.metrics', async () => 'ok', { authz: 'public' })({}, { actor: null });
    await useCase(
      'demo.metrics',
      async () => {
        throw new Error('x');
      },
      { authz: 'public' },
    )({}, { actor: null }).catch(() => {});
    const text = await metrics.registry.metrics();
    expect(text).toMatch(/usecase_duration_seconds_count\{usecase="demo.metrics",outcome="ok"\} 1/);
    expect(text).toMatch(
      /usecase_duration_seconds_count\{usecase="demo.metrics",outcome="error"\} 1/,
    );
  });
});
