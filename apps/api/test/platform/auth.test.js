// @ts-check
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  authHooks,
  bearerToken,
  createTokenVerifier,
  RETIRED_KEY_GRACE_MS,
} from '../../src/platform/auth.js';
import { fixedClock, systemClock } from '../../src/platform/clock.js';
import { createErrorHandler } from '../../src/platform/errors.js';
import { makeKeys } from './helpers.js';

/** @param {string} json */
const parseKeys = (json) => JSON.parse(json);

describe('token verification', () => {
  it('accepts a valid user token and returns the principal', async () => {
    const keys = await makeKeys();
    const verifier = await createTokenVerifier({ keys: parseKeys(keys.json), clock: systemClock });
    const principal = await verifier.verify(
      await keys.sign({ sub: 'u1', sid: 's1' }),
      'vouch:user',
    );
    expect(principal).toEqual({
      userId: 'u1',
      audience: 'vouch:user',
      mfa: false,
      sessionId: 's1',
    });
  });

  it('rejects the wrong audience in both directions', async () => {
    const keys = await makeKeys();
    const verifier = await createTokenVerifier({ keys: parseKeys(keys.json), clock: systemClock });
    const userToken = await keys.sign({ sub: 'u1' });
    const adminToken = await keys.sign({ sub: 'a1', amr: ['mfa'] }, { audience: 'vouch:admin' });
    await expect(verifier.verify(userToken, 'vouch:admin')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(verifier.verify(adminToken, 'vouch:user')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects expired tokens, unknown kids and garbage', async () => {
    const keys = await makeKeys();
    const verifier = await createTokenVerifier({ keys: parseKeys(keys.json), clock: systemClock });
    await expect(
      verifier.verify(await keys.sign({}, { expiresIn: '-1m' }), 'vouch:user'),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      verifier.verify(await keys.sign({}, { kid: 'other' }), 'vouch:user'),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verifier.verify('not.a.jwt', 'vouch:user')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('keeps accepting a retired key for the grace window, then rejects it', async () => {
    const retiredAt = new Date('2026-11-21T10:00:00Z');
    const keys = await makeKeys({ retiredAt: retiredAt.toISOString() });
    const inGraceAt = new Date(retiredAt.getTime() + RETIRED_KEY_GRACE_MS - 60_000);
    const afterGraceAt = new Date(retiredAt.getTime() + RETIRED_KEY_GRACE_MS + 60_000);
    const verifierAt = (/** @type {Date} */ at) =>
      createTokenVerifier({ keys: parseKeys(keys.json), clock: fixedClock(at) });

    const inGrace = await verifierAt(inGraceAt);
    expect(
      await inGrace.verify(await keys.sign({ sub: 'u1' }, { at: inGraceAt }), 'vouch:user'),
    ).toMatchObject({ userId: 'u1' });

    const afterGrace = await verifierAt(afterGraceAt);
    await expect(
      afterGrace.verify(await keys.sign({ sub: 'u1' }, { at: afterGraceAt }), 'vouch:user'),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('parses bearer tokens strictly', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe('authHooks (authenticate, then enforce)', () => {
  async function app({ adminIpAllowlist = /** @type {string[]} */ ([]) } = {}) {
    const keys = await makeKeys();
    const verifier = await createTokenVerifier({ keys: parseKeys(keys.json), clock: systemClock });
    const server = Fastify({ logger: false });
    server.setErrorHandler(createErrorHandler());
    const hooks = authHooks({ verifier, adminIpAllowlist });
    server.addHook('onRequest', hooks.authenticate);
    server.addHook('preValidation', hooks.enforce);
    for (const mode of ['public', 'optional', 'user', 'admin']) {
      server.get(`/${mode}`, { config: { auth: mode } }, async (/** @type {any} */ request) => ({
        user: request.user?.userId ?? null,
      }));
    }
    return { server, keys };
  }

  it('applies each route mode', async () => {
    const { server, keys } = await app();
    const userToken = `Bearer ${await keys.sign({ sub: 'u1' })}`;
    expect((await server.inject({ url: '/public' })).json()).toEqual({ user: null });
    expect((await server.inject({ url: '/optional' })).json()).toEqual({ user: null });
    expect(
      (await server.inject({ url: '/optional', headers: { authorization: userToken } })).json(),
    ).toEqual({ user: 'u1' });
    expect((await server.inject({ url: '/user' })).json().error.code).toBe('UNAUTHENTICATED');
    expect(
      (await server.inject({ url: '/user', headers: { authorization: userToken } })).json(),
    ).toEqual({ user: 'u1' });
  });

  it('admin routes need the admin audience with MFA, and an allowlisted IP when configured', async () => {
    const { server, keys } = await app();
    const noMfa = `Bearer ${await keys.sign({ sub: 'a1' }, { audience: 'vouch:admin' })}`;
    const withMfa = `Bearer ${await keys.sign({ sub: 'a1', amr: ['otp', 'mfa'] }, { audience: 'vouch:admin' })}`;
    const userToken = `Bearer ${await keys.sign({ sub: 'u1' })}`;
    expect(
      (await server.inject({ url: '/admin', headers: { authorization: userToken } })).json().error
        .code,
    ).toBe('UNAUTHENTICATED');
    expect(
      (await server.inject({ url: '/admin', headers: { authorization: noMfa } })).json().error.code,
    ).toBe('MFA_REQUIRED');
    expect(
      (await server.inject({ url: '/admin', headers: { authorization: withMfa } })).json(),
    ).toEqual({ user: 'a1' });

    const locked = await app({ adminIpAllowlist: ['10.0.0.1'] });
    const lockedToken = `Bearer ${await locked.keys.sign({ sub: 'a1', amr: ['mfa'] }, { audience: 'vouch:admin' })}`;
    expect(
      (
        await locked.server.inject({ url: '/admin', headers: { authorization: lockedToken } })
      ).json().error.code,
    ).toBe('IP_NOT_ALLOWED');
  });
});
