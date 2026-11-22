// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlatform, startRole } from '../../src/platform/boot.js';
import { clientIpOf, createProxyTrust } from '../../src/platform/client-ip.js';
import { loadConfig } from '../../src/platform/config.js';
import { createLogger } from '../../src/platform/logger.js';
import { defineModule } from '../../src/platform/registry.js';
import { HOOK_TIMEOUT_MS, makeKeys, startInfra, testEnv } from './helpers.js';

const H = { 'x-app-version': '1.0.0' };

/** Test-only routes: one per auth mode, and an echo of the resolved client IP. */
const probe = defineModule({
  name: 'probe',
  version: 1,
  http: {
    routes: async () => async (/** @type {import('fastify').FastifyInstance} */ app) => {
      app.get('/t/user', { config: { auth: 'user' } }, async () => ({ ok: true }));
      app.get('/t/public', { config: { auth: 'public' } }, async () => ({ ok: true }));
      app.get('/t/ip', { config: { auth: 'public' } }, async (request) => ({
        ip: clientIpOf(request),
      }));
    },
  },
});

describe('proxy trust (unit)', () => {
  it('matches exact IPs and CIDRs, IPv4, IPv6 and IPv4-mapped sockets; an empty list trusts nothing', () => {
    const trust = createProxyTrust(['10.0.0.0/8', '203.0.113.7', '2001:db8::/32']);
    expect(trust.isTrusted('10.1.2.3')).toBe(true);
    expect(trust.isTrusted('::ffff:10.1.2.3')).toBe(true);
    expect(trust.isTrusted('203.0.113.7')).toBe(true);
    expect(trust.isTrusted('203.0.113.8')).toBe(false);
    expect(trust.isTrusted('2001:db8::1')).toBe(true);
    expect(trust.isTrusted('2001:db9::1')).toBe(false);
    expect(trust.isTrusted('not-an-ip')).toBe(false);
    expect(createProxyTrust([]).isTrusted('10.1.2.3')).toBe(false);
  });
});

describe('global rate limit and client IP (real Redis)', () => {
  /** @type {import('./helpers.js').Infra} */
  let infra;
  /** @type {import('./helpers.js').TestKeys} */
  let keys;
  /** @type {any} */
  let untrusted;
  /** @type {any} */
  let trusted;

  /** @param {Record<string, string>} env */
  async function start(env) {
    const config = loadConfig(
      testEnv({
        ROLE: 'api',
        DATABASE_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
        RATE_LIMIT_USER_MINUTE: '20',
        RATE_LIMIT_IP_MINUTE: '100',
        ...env,
      }),
    );
    const platform = await createPlatform({ config, logger: createLogger({ level: 'silent' }) });
    return startRole({ platform, modules: [probe], listen: false });
  }
  /** @param {string} userId */
  const bearer = async (userId) => ({
    ...H,
    authorization: `Bearer ${await keys.sign({ sub: userId, sid: randomUUID() })}`,
  });

  beforeAll(async () => {
    infra = await startInfra();
    keys = await makeKeys({ kid: 'active-1' });
    untrusted = await start({});
    trusted = await start({ TRUSTED_PROXIES: '198.51.100.0/24, 2001:db8::/32' });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await untrusted?.stop(10_000);
    await trusted?.stop(10_000);
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('50 different signed-in users behind one IP are not throttled (500 requests, IP limit 100)', async () => {
    const remoteAddress = '192.0.2.10';
    const users = Array.from({ length: 50 }, () => randomUUID());
    const statuses = [];
    for (const user of users) {
      const headers = await bearer(user);
      const replies = await Promise.all(
        Array.from({ length: 10 }, () =>
          untrusted.http.inject({ url: '/t/user', headers, remoteAddress }),
        ),
      );
      statuses.push(...replies.map((/** @type {any} */ r) => r.statusCode));
    }
    expect(statuses).toHaveLength(500);
    expect(new Set(statuses)).toEqual(new Set([200]));
  });

  it('one user over RATE_LIMIT_USER_MINUTE is throttled', async () => {
    const headers = await bearer(randomUUID());
    const replies = [];
    for (let i = 0; i < 21; i += 1) {
      replies.push(
        await untrusted.http.inject({ url: '/t/user', headers, remoteAddress: '192.0.2.11' }),
      );
    }
    expect(replies.slice(0, 20).every((r) => r.statusCode === 200)).toBe(true);
    expect(replies.at(-1)?.statusCode).toBe(429);
  });

  it('unauthenticated requests share the per-IP limit', async () => {
    const remoteAddress = '192.0.2.12';
    const statuses = [];
    for (let i = 0; i < 101; i += 1) {
      statuses.push(
        (await untrusted.http.inject({ url: '/t/public', headers: H, remoteAddress })).statusCode,
      );
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(100);
    expect(statuses.at(-1)).toBe(429);
  });

  it('a flood of missing or bad tokens counts against the IP limit and is throttled', async () => {
    const remoteAddress = '192.0.2.13';
    const statuses = [];
    for (let i = 0; i < 110; i += 1) {
      const headers = i % 2 === 0 ? { ...H, authorization: `Bearer junk-${i}` } : H;
      statuses.push(
        (await untrusted.http.inject({ url: '/t/user', headers, remoteAddress })).statusCode,
      );
    }
    expect(statuses.slice(0, 100).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(100).every((s) => s === 429)).toBe(true);
  });

  it('a forged X-Forwarded-For or CF-Connecting-IP from an untrusted address is ignored', async () => {
    const forged = await untrusted.http.inject({
      url: '/t/ip',
      headers: { ...H, 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' },
      remoteAddress: '192.0.2.14',
    });
    expect(forged.json()).toEqual({ ip: '192.0.2.14' });
    // Rotating forged addresses does not escape the IP limit either.
    const statuses = [];
    for (let i = 0; i < 101; i += 1) {
      statuses.push(
        (
          await untrusted.http.inject({
            url: '/t/public',
            headers: { ...H, 'x-forwarded-for': `10.9.${i}.1`, 'cf-connecting-ip': `10.8.${i}.1` },
            remoteAddress: '192.0.2.15',
          })
        ).statusCode,
      );
    }
    expect(statuses.at(-1)).toBe(429);
  });

  it('from a trusted proxy, CF-Connecting-IP is preferred, then X-Forwarded-For; from others, the socket', async () => {
    /** @param {Record<string, string>} headers @param {string} remoteAddress */
    const ip = async (headers, remoteAddress) =>
      (
        await trusted.http.inject({ url: '/t/ip', headers: { ...H, ...headers }, remoteAddress })
      ).json().ip;
    expect(
      await ip(
        { 'cf-connecting-ip': '203.0.113.50', 'x-forwarded-for': '1.2.3.4' },
        '198.51.100.7',
      ),
    ).toBe('203.0.113.50');
    expect(await ip({ 'x-forwarded-for': '203.0.113.51' }, '198.51.100.7')).toBe('203.0.113.51');
    // Hops are walked from the right: a client-supplied left-most value is not believed.
    expect(await ip({ 'x-forwarded-for': '6.6.6.6, 203.0.113.52' }, '198.51.100.7')).toBe(
      '203.0.113.52',
    );
    expect(
      await ip(
        { 'x-forwarded-for': '203.0.113.53', 'cf-connecting-ip': '203.0.113.54' },
        '192.0.2.20',
      ),
    ).toBe('192.0.2.20');
    expect(await ip({ 'cf-connecting-ip': 'not-an-ip' }, '198.51.100.7')).toBe('198.51.100.7');
    expect(await ip({ 'cf-connecting-ip': '2001:db8::99' }, '::ffff:198.51.100.7')).toBe(
      '2001:db8::99',
    );
  });
});
