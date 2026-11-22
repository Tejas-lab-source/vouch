// @ts-check
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  listDevices as listDevicesEndpoint,
  refreshTokens as refreshEndpoint,
  verifyOtp as verifyEndpoint,
} from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import identityModule from '../../../src/modules/identity/manifest.js';
import { createPlatform, startRole } from '../../../src/platform/boot.js';
import { loadConfig } from '../../../src/platform/config.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  eventually,
  HOOK_TIMEOUT_MS,
  makeKeys,
  startInfra,
  testEnv,
} from '../../platform/helpers.js';

const DOMAIN = 'northfield.example.edu';
const H = { 'x-app-version': '1.0.0' };
const SIGNUP = {
  birthDate: '2005-01-31',
  gradYear: 2028,
  consent: { noticeVersion: 'draft', purposes: ['matching'] },
};

describe('identity module (ROLE=all, real Postgres and Redis)', () => {
  /** @type {import('../../platform/helpers.js').Infra} */
  let infra;
  /** @type {import('../../platform/helpers.js').TestKeys} */
  let keys;
  /** @type {{ to: string, code: string }[]} */
  const mail = [];
  /** @type {string[]} */
  const logLines = [];
  /** @type {Awaited<ReturnType<typeof start>>} */
  let app;
  let n = 0;

  /**
   * Boots identity with a capturing email provider and a logger whose output is kept.
   * @param {Record<string, string>} [env]
   */
  async function start(env = {}) {
    const config = loadConfig(
      testEnv({
        ROLE: 'all',
        DATABASE_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
        ...env,
      }),
    );
    const destination = new Writable({
      write(chunk, _e, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    const platform = await createPlatform({
      config,
      logger: createLogger({ level: 'debug', destination }),
    });
    const runtime = await startRole({
      platform: /** @type {any} */ ({
        ...platform,
        overrides: {
          identity: {
            email: {
              sendOtp: async (/** @type {any} */ m) => void mail.push({ to: m.to, code: m.code }),
            },
          },
        },
      }),
      modules: [identityModule],
      listen: false,
    });
    return runtime;
  }

  /** A unique college address for each test. */
  const freshEmail = () => `student${++n}+tag@${DOMAIN}`;
  /** @param {string} email */
  const lastCodeFor = (email) =>
    mail.filter((m) => m.to === email.replace(/\+[^@]*/, '')).at(-1)?.code;

  /** @param {any} runtime @param {string} url @param {any} payload @param {Record<string, string>} [headers] */
  const post = (runtime, url, payload, headers = {}) =>
    runtime.http.inject({
      method: 'POST',
      url,
      payload,
      headers: { ...H, 'idempotency-key': `k-${++n}-${Date.now()}`, ...headers },
    });

  /** Signs up a new user; returns their email and tokens. */
  async function signUp(runtime = app, transport = 'body') {
    const email = freshEmail();
    expect((await post(runtime, '/v1/auth/otp', { email, turnstileToken: 'dev' })).json()).toEqual({
      sent: true,
    });
    const response = await post(runtime, '/v1/auth/verify', {
      email,
      code: lastCodeFor(email),
      device: { platform: 'ios' },
      signup: SIGNUP,
      tokenTransport: transport,
    });
    expect(response.statusCode).toBe(200);
    return { email, response, body: response.json() };
  }

  /** @param {string} accessToken */
  const auth = (accessToken) => ({ ...H, authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    infra = await startInfra();
    keys = await makeKeys({ kid: 'active-1' });
    await infra.admin`INSERT INTO platform.campus_clusters (id, name, city) VALUES ('01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60', 'Test', 'Pune')`;
    await infra.admin`INSERT INTO platform.colleges (id, name, email_domains, cluster_id, city)
      VALUES ('01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f', 'Northfield', ${[DOMAIN]}, '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60', 'Pune')`;
    app = await start();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.stop(10_000);
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('full cycle: OTP → SIGNUP_DETAILS_REQUIRED (code kept) → sign-up → refresh → rotate', async () => {
    const email = freshEmail();
    await post(app, '/v1/auth/otp', { email, turnstileToken: 'dev' });
    const code = lastCodeFor(email);
    const needsDetails = await post(app, '/v1/auth/verify', {
      email,
      code,
      device: { platform: 'ios' },
    });
    expect(needsDetails.json().error.code).toBe('SIGNUP_DETAILS_REQUIRED');

    const verified = await post(app, '/v1/auth/verify', {
      email,
      code,
      device: { platform: 'ios', appVersion: '1.0.0' },
      signup: SIGNUP,
    });
    expect(verified.statusCode).toBe(200);
    const body = verified.json();
    expect(verifyEndpoint.response.schema.safeParse(body).success).toBe(true);
    expect(body.user).toMatchObject({ status: 'active', newUser: true });

    const [row] =
      await infra.admin`SELECT id, status, email_hmac FROM identity.users WHERE public_id = ${body.user.userId}`;
    expect(row.status).toBe('active');
    const events =
      await infra.admin`SELECT name FROM platform.outbox WHERE payload->>'userId' = ${row.id}`;
    expect(events.map((e) => e.name)).toEqual(['user.created.v1']);
    expect(
      await infra.admin`SELECT 1 FROM identity.consents WHERE user_id = ${row.id}`,
    ).toHaveLength(1);

    expect(
      (await post(app, '/v1/auth/verify', { email, code, device: { platform: 'ios' } })).json()
        .error.code,
    ).toBe('OTP_EXPIRED');

    const refreshed = await post(app, '/v1/auth/refresh', {
      refreshToken: body.tokens.refreshToken,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshEndpoint.response.schema.safeParse(refreshed.json()).success).toBe(true);
    const devices = await app.http.inject({
      url: '/v1/me/devices',
      headers: auth(refreshed.json().tokens.accessToken),
    });
    expect(listDevicesEndpoint.response.schema.parse(devices.json()).items[0]?.current).toBe(true);
  });

  /** @param {string} token */
  const refreshWith = async (token) => post(app, '/v1/auth/refresh', { refreshToken: token });
  /** @param {string} publicId */
  const liveSessions = async (publicId) =>
    (
      await infra.admin`SELECT s.id FROM identity.auth_sessions s JOIN identity.users u ON u.id = s.user_id
        WHERE u.public_id = ${publicId} AND s.revoked_at IS NULL`
    ).length;

  it('reusing a rotated refresh token after its replacement was used revokes the whole family', async () => {
    const { body } = await signUp();
    const first = body.tokens.refreshToken;
    const second = (await refreshWith(first)).json().tokens.refreshToken;
    const third = (await refreshWith(second)).json().tokens.refreshToken;
    expect((await refreshWith(first)).json().error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(await liveSessions(body.user.userId)).toBe(0);
    expect((await refreshWith(third)).json().error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('a retry within the 30 s grace window gets a fresh pair in the same family', async () => {
    const { body } = await signUp();
    const first = body.tokens.refreshToken;
    const lost = (await refreshWith(first)).json().tokens.refreshToken;
    const retried = await refreshWith(first);
    expect(retried.statusCode).toBe(200);
    expect(await liveSessions(body.user.userId)).toBe(1);
    const families = await infra.admin`SELECT DISTINCT s.family_id FROM identity.auth_sessions s
      JOIN identity.users u ON u.id = s.user_id WHERE u.public_id = ${body.user.userId}`;
    expect(families).toHaveLength(1);
    expect((await refreshWith(retried.json().tokens.refreshToken)).statusCode).toBe(200);
    // The lost replacement was retired; presenting it after the new pair was used is reuse.
    expect((await refreshWith(lost)).json().error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(await liveSessions(body.user.userId)).toBe(0);
  });

  it('a retry after the grace window revokes the whole family', async () => {
    const { body } = await signUp();
    const first = body.tokens.refreshToken;
    const second = (await refreshWith(first)).json().tokens.refreshToken;
    // Move the rotation 31 s into the past instead of waiting.
    await infra.admin`UPDATE identity.auth_sessions SET revoked_at = now() - interval '31 seconds'
      WHERE token_hash = ${createHash('sha256').update(first).digest()}`;
    expect((await refreshWith(first)).json().error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(await liveSessions(body.user.userId)).toBe(0);
    expect((await refreshWith(second)).json().error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('web transport: the refresh token is an httpOnly, Secure, SameSite=Strict cookie on /v1/auth/refresh', async () => {
    const { response, body } = await signUp(app, 'cookie');
    expect(body.tokens.refreshToken).toBeUndefined();
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^vouch_refresh=/);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/v1/auth/refresh'])
      expect(cookie).toContain(attribute);
    const value = cookie.split(';')[0]?.split('=').slice(1).join('=');
    const refreshed = await post(
      app,
      '/v1/auth/refresh',
      { tokenTransport: 'cookie' },
      { cookie: `vouch_refresh=${value}` },
    );
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().tokens.refreshToken).toBeUndefined();
  });

  it('logout, a second device, remote sign-out and push-token registration', async () => {
    const { email, body } = await signUp();
    await post(app, '/v1/auth/otp', { email, turnstileToken: 'dev' });
    const second = (
      await post(app, '/v1/auth/verify', {
        email,
        code: lastCodeFor(email),
        device: { platform: 'web' },
      })
    ).json();
    expect(second.user.newUser).toBe(false);

    const list = (
      await app.http.inject({ url: '/v1/me/devices', headers: auth(body.tokens.accessToken) })
    ).json();
    expect(list.items).toHaveLength(2);
    const other = list.items.find((/** @type {any} */ d) => !d.current);
    const revoked = await app.http.inject({
      method: 'DELETE',
      url: `/v1/me/devices/${other.id}`,
      headers: auth(body.tokens.accessToken),
    });
    expect(revoked.json()).toEqual({ revoked: true });
    expect(
      (await post(app, '/v1/auth/refresh', { refreshToken: second.tokens.refreshToken })).json()
        .error.code,
    ).toBe('REFRESH_TOKEN_INVALID');

    const push = await post(
      app,
      '/v1/devices',
      { pushToken: 'ExponentPushToken[abc]', platform: 'ios' },
      auth(body.tokens.accessToken),
    );
    expect(push.json()).toEqual({ registered: true });

    const loggedOut = await post(app, '/v1/auth/logout', {}, auth(body.tokens.accessToken));
    expect(loggedOut.json()).toEqual({ loggedOut: true });
    expect(
      (await post(app, '/v1/auth/refresh', { refreshToken: body.tokens.refreshToken })).json().error
        .code,
    ).toBe('REFRESH_TOKEN_INVALID');
  });

  it('delete account emits user.deleted.v1 once, signs out, and blocks re-sign-up while erasing', async () => {
    const { email, body } = await signUp();
    const [user] =
      await infra.admin`SELECT id FROM identity.users WHERE public_id = ${body.user.userId}`;
    const first = await app.http.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: auth(body.tokens.accessToken),
    });
    const second = await app.http.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: auth(body.tokens.accessToken),
    });
    expect(first.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(
      await infra.admin`SELECT 1 FROM platform.outbox WHERE name = 'user.deleted.v1' AND payload->>'userId' = ${user.id}`,
    ).toHaveLength(1);
    expect(
      (await post(app, '/v1/auth/refresh', { refreshToken: body.tokens.refreshToken })).json().error
        .code,
    ).toBe('REFRESH_TOKEN_INVALID');

    await post(app, '/v1/auth/otp', { email, turnstileToken: 'dev' });
    const again = await post(app, '/v1/auth/verify', {
      email,
      code: lastCodeFor(email),
      device: { platform: 'ios' },
      signup: SIGNUP,
    });
    expect(again.json().error.code).toBe('FORBIDDEN');
  });

  it('exports identity data (no email), and the ban consumer signs the user out', async () => {
    const { email, body } = await signUp();
    const exported = (
      await app.http.inject({ url: '/v1/me/export', headers: auth(body.tokens.accessToken) })
    ).json();
    expect(exported.data.identity.account.publicId).toBe(body.user.userId);
    expect(JSON.stringify(exported)).not.toContain(DOMAIN);

    const [user] =
      await infra.admin`SELECT id FROM identity.users WHERE public_id = ${body.user.userId}`;
    await infra.admin`INSERT INTO platform.outbox (name, version, payload) VALUES ('user.banned.v1', 1,
      ${infra.admin.json({ userId: user.id, banId: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e61', expiresAt: null, bannedAt: new Date().toISOString() })})`;
    await eventually(
      async () =>
        (await infra.admin`SELECT status FROM identity.users WHERE id = ${user.id}`)[0]?.status ===
        'banned',
      15_000,
    );
    expect(
      (await post(app, '/v1/auth/refresh', { refreshToken: body.tokens.refreshToken })).json().error
        .code,
    ).toBe('REFRESH_TOKEN_INVALID');
    await post(app, '/v1/auth/otp', { email, turnstileToken: 'dev' });
    expect(
      (
        await post(app, '/v1/auth/verify', {
          email,
          code: lastCodeFor(email),
          device: { platform: 'ios' },
        })
      ).json().error.code,
    ).toBe('ACCOUNT_BANNED');
  }, 30_000);

  it('rejects alumni.<college domain>, an admin-audience token on user routes, and a retired key after its grace', async () => {
    const alumni = await post(app, '/v1/auth/otp', {
      email: `x@alumni.${DOMAIN}`,
      turnstileToken: 'dev',
    });
    expect(alumni.json().error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');

    const { body } = await signUp();
    const [user] =
      await infra.admin`SELECT id FROM identity.users WHERE public_id = ${body.user.userId}`;
    const adminToken = await keys.sign({ sub: user.id, amr: ['mfa'] }, { audience: 'vouch:admin' });
    expect(
      (await app.http.inject({ url: '/v1/me/devices', headers: auth(adminToken) })).json().error
        .code,
    ).toBe('UNAUTHENTICATED');

    const old = await makeKeys({
      kid: 'old-1',
      retiredAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const rotated = await start({
      JWT_SIGNING_KEYS: JSON.stringify([...JSON.parse(old.json), ...JSON.parse(keys.json)]),
      JWT_ACTIVE_KID: keys.kid,
    });
    const retiredToken = await old.sign({ sub: user.id, sid: 'x' });
    expect(
      (await rotated.http.inject({ url: '/v1/me/devices', headers: auth(retiredToken) })).json()
        .error.code,
    ).toBe('UNAUTHENTICATED');
    await rotated.stop(10_000);
  }, 30_000);

  it('rate limits trigger at their thresholds (configurable)', async () => {
    // Clients are told apart by X-Forwarded-For, believed only from a trusted proxy (ADR 0015):
    // the injected requests come from 127.0.0.1, which plays the proxy here.
    const limited = await start({
      TRUSTED_PROXIES: '127.0.0.1',
      RATE_LIMIT_OTP_EMAIL_15M: '2',
      RATE_LIMIT_OTP_DEVICE_HOUR: '3',
      RATE_LIMIT_OTP_IP_HOUR: '6',
      RATE_LIMIT_VERIFY_IP_15M: '2',
    });
    const email = freshEmail();
    const codes = [];
    for (let i = 0; i < 3; i += 1)
      codes.push(
        (
          await post(
            limited,
            '/v1/auth/otp',
            { email, turnstileToken: 'dev' },
            { 'x-forwarded-for': '198.51.100.1' },
          )
        ).statusCode,
      );
    expect(codes).toEqual([200, 200, 429]);

    const deviceId = '3b241101-e2bb-4255-8caf-4136c566a962';
    const perDevice = [];
    for (let i = 0; i < 4; i += 1) {
      perDevice.push(
        (
          await post(
            limited,
            '/v1/auth/otp',
            { email: freshEmail(), turnstileToken: 'dev', deviceId },
            { 'x-forwarded-for': '198.51.100.2' },
          )
        ).statusCode,
      );
    }
    expect(perDevice).toEqual([200, 200, 200, 429]);

    const perIp = [];
    for (let i = 0; i < 7; i += 1)
      perIp.push(
        (
          await post(
            limited,
            '/v1/auth/otp',
            { email: freshEmail(), turnstileToken: 'dev' },
            { 'x-forwarded-for': '198.51.100.3' },
          )
        ).statusCode,
      );
    expect(perIp.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(perIp[6]).toBe(429);

    const verifies = [];
    for (let i = 0; i < 3; i += 1) {
      verifies.push(
        (
          await post(
            limited,
            '/v1/auth/verify',
            { email, code: '000000', device: { platform: 'ios' } },
            { 'x-forwarded-for': '198.51.100.4' },
          )
        ).json().error.code,
      );
    }
    expect(verifies.at(-1)).toBe('RATE_LIMITED');
    await limited.stop(10_000);
  }, 60_000);

  it('the defaults are the approved limits', () => {
    const config = loadConfig(testEnv());
    expect([
      config.RATE_LIMIT_OTP_EMAIL_15M,
      config.RATE_LIMIT_OTP_EMAIL_DAY,
      config.RATE_LIMIT_OTP_IP_HOUR,
      config.RATE_LIMIT_OTP_DEVICE_HOUR,
      config.RATE_LIMIT_VERIFY_IP_15M,
      config.RATE_LIMIT_REFRESH_SESSION_HOUR,
    ]).toEqual([3, 10, 300, 5, 300, 60]);
  });

  it('OTP requests fail closed when Redis is down; other routes keep working (fail open)', async () => {
    const { body } = await signUp();
    const before = mail.length;
    infra.redisControl('pause');
    try {
      const otp = await post(app, '/v1/auth/otp', { email: freshEmail(), turnstileToken: 'dev' });
      expect(otp.statusCode).toBe(503);
      expect(otp.json().error.code).toBe('TEMPORARILY_UNAVAILABLE');
      expect(mail.length).toBe(before);
      const devices = await app.http.inject({
        url: '/v1/me/devices',
        headers: auth(body.tokens.accessToken),
      });
      expect(devices.statusCode).toBe(200);
    } finally {
      infra.redisControl('unpause');
    }
  }, 60_000);

  it('the retention job purges old sessions, revoked devices and erased accounts', async () => {
    const { body } = await signUp();
    const [user] =
      await infra.admin`SELECT id FROM identity.users WHERE public_id = ${body.user.userId}`;
    await infra.admin`UPDATE identity.users SET status = 'deleted', deleted_at = now() - interval '31 days' WHERE id = ${user.id}`;
    await app.platform.jobs.queue('bulk').add('identity.retentionTick', {});
    await eventually(
      async () =>
        (await infra.admin`SELECT 1 FROM identity.users WHERE id = ${user.id}`).length === 0,
      20_000,
    );
    expect(
      await infra.admin`SELECT 1 FROM identity.auth_sessions WHERE user_id = ${user.id}`,
    ).toHaveLength(0);
  }, 30_000);

  it('logs contain no email address, OTP code or token', async () => {
    const secrets = [DOMAIN, ...mail.map((m) => m.code)];
    const text = logLines.join('');
    expect(text.length).toBeGreaterThan(0);
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
  });
});
