// @ts-check
import { randomUUID } from 'node:crypto';
import { ENDPOINTS } from '@vouch/contracts';
import { connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_TIMEOUT_MS, makeKeys } from '../../platform/helpers.js';
import { startBackend } from '../phase10/harness.js';

const WEB = 'https://app.vouch.test';

/**
 * A sample value for a path parameter, so the request reaches the auth check (which runs before
 * validation). The value is well-formed for its kind but names nothing that exists.
 * @param {string} name
 */
const sampleParam = (name) =>
  name === 'userId' || name === 'otherUserId'
    ? 'u_nobody0000000000000000'
    : name === 'type'
      ? 'basics'
      : name === 'key'
        ? 'test.flag'
        : '01900000-0000-7000-8000-000000000000';

/** @param {string} path */
const fill = (path) => path.replace(/\{(\w+)\}/g, (_m, name) => sampleParam(name));

/**
 * Phase 14 security review: headers, CORS, cookies, input limits, and an authorisation matrix
 * over every contract route (no token, the wrong kind of token, a forged token, and the wrong
 * user's ids).
 */
describe('security (Phase 14)', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;
  /** @type {Awaited<ReturnType<Awaited<ReturnType<typeof startBackend>>['signUp']>>} */
  let user;
  let adminToken = '';

  beforeAll(async () => {
    b = await startBackend({ CORS_ORIGINS: WEB });
    user = await b.signUp();
    adminToken = await (await b.createStaff('admin')).login();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  it('sends the security headers and no framework banner', async () => {
    const res = await b.app.http.inject({ method: 'GET', url: '/v1/config' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only from the configured origins', async () => {
    const preflight = (/** @type {string} */ origin) =>
      b.app.http.inject({
        method: 'OPTIONS',
        url: '/v1/me/profile',
        headers: {
          origin,
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
    const allowed = await preflight(WEB);
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const evil = await preflight('https://evil.example.com');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses request bodies over 64 KB before they are parsed', async () => {
    const res = await b.call('POST', '/v1/auth/otp', {
      body: { email: `${'a'.repeat(100 * 1024)}@student.example.edu` },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'The request body is too large.',
    });
  });

  it('closes a socket that sends a message over 16 KB', async () => {
    const socket = await b.socket(user.token);
    const closed = new Promise((resolve) => socket.once('disconnect', resolve));
    socket.emit('message.send', {
      conversationId: randomUUID(),
      clientMsgId: randomUUID(),
      kind: 'text',
      body: 'x'.repeat(20 * 1024),
    });
    await expect(
      Promise.race([closed, new Promise((_, reject) => setTimeout(reject, 5_000))]),
    ).resolves.toBe('transport close');
  });

  it('refuses sockets without a valid user token', async () => {
    for (const token of ['', 'not-a-jwt', adminToken]) {
      const s = connect(b.url, {
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
        forceNew: true,
      });
      const outcome = await new Promise((resolve) => {
        s.once('connect', () => resolve('connected'));
        s.once('connect_error', () => resolve('refused'));
      });
      s.disconnect();
      expect(outcome).toBe('refused');
    }
  });

  it('every route: no token, the wrong kind of token, and a forged token are refused', async () => {
    const forged = await (await makeKeys()).sign({ sub: user.id, sid: randomUUID() });
    /** @type {string[]} */
    const failures = [];
    for (const endpoint of Object.values(ENDPOINTS)) {
      const path = fill(endpoint.path);
      const method = /** @type {any} */ (endpoint.method);
      const body = ['POST', 'PUT', 'PATCH'].includes(endpoint.method) ? {} : undefined;
      const as = async (/** @type {string | undefined} */ token) =>
        (await b.call(method, path, { token, body })).status;
      const expectStatus = async (
        /** @type {string} */ who,
        /** @type {string | undefined} */ token,
        /** @type {number[]} */ allowed,
      ) => {
        const status = await as(token);
        if (!allowed.includes(status)) failures.push(`${endpoint.id} ${who}: ${status}`);
      };
      if (endpoint.auth === 'user') {
        await expectStatus('no token', undefined, [401]);
        await expectStatus('admin token', adminToken, [401, 403]);
        await expectStatus('forged', forged, [401]);
      } else if (endpoint.auth === 'admin') {
        await expectStatus('no token', undefined, [401]);
        await expectStatus('user token', user.token, [401, 403]);
        await expectStatus('forged', forged, [401]);
      } else {
        // Public routes never demand a token.
        const status = await as(undefined);
        if (status === 401 && endpoint.id !== 'refreshTokens') {
          failures.push(`${endpoint.id} public: 401`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it('injection: SQL metacharacters are data, and unexpected keys (prototype pollution) are refused', async () => {
    const evil = "x' OR '1'='1'; DROP TABLE admin.audit_log; --";
    const log = await b.call(
      'GET',
      `/v1/admin/audit-log?targetId=${encodeURIComponent(evil)}&limit=50`,
      { token: adminToken },
    );
    expect(log.status).toBe(200);
    expect(log.body.items).toEqual([]);
    const lookup = await b.call('GET', `/v1/admin/users/${encodeURIComponent(evil)}`, {
      token: adminToken,
    });
    expect(lookup.status).toBe(400);
    expect(await b.infra.admin`SELECT to_regclass('admin.audit_log') IS NOT NULL AS ok`).toEqual([
      { ok: true },
    ]);

    const polluted = await b.app.http.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        'x-app-version': '1.0.0',
      },
      payload: '{"bio":"hi","__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}',
    });
    expect(polluted.statusCode).toBe(400);
    expect(/** @type {any} */ ({}).admin).toBeUndefined();
  });

  it("the wrong user's ids: another user's devices, uploads, photos, matches and chats are not reachable", async () => {
    const [owner, intruder, partner] = [user, await b.signUp(), await b.signUp()];
    const matchId = await b.match(owner, partner);
    const photoId = await b.uploadPhoto(owner.token);
    const upload = await b.call('POST', '/v1/media/uploads', {
      token: owner.token,
      body: { contentType: 'image/jpeg', sizeBytes: 1000 },
    });
    const [device] = await b.infra
      .admin`SELECT id FROM identity.devices WHERE user_id = ${owner.id} LIMIT 1`;
    const as = (
      /** @type {any} */ method,
      /** @type {string} */ path,
      /** @type {unknown} */ body = undefined,
    ) => b.call(method, path, { token: intruder.token, body });

    const attempts = [
      await as('DELETE', `/v1/me/devices/${device.id}`),
      await as('DELETE', `/v1/me/photos/${photoId}`),
      await as('POST', `/v1/media/uploads/${upload.body.uploadId}/confirm`, {}),
      await as('GET', `/v1/conversations/${matchId}/messages`),
      await as('POST', `/v1/matches/${matchId}/unmatch`, {}),
      await as('PUT', '/v1/me/photos/order', { photoIds: [photoId] }),
    ];
    // Scoped to the caller: a foreign id is "not found", or (photo delete, which is
    // idempotent) a no-op that returns the caller's own profile. Nothing of the owner leaks.
    expect(attempts.map((r) => r.status)).toEqual([404, 200, 404, 403, 404, 400]);
    expect(attempts[1]?.body.userId).toBe(intruder.publicId);
    expect(JSON.stringify(attempts)).not.toContain(owner.publicId);

    // Nothing changed for the owner.
    const [still] = await b.infra
      .admin`SELECT revoked_at IS NULL AS live FROM identity.devices WHERE id = ${device.id}`;
    expect(still.live).toBe(true);
    const [match] = await b.infra
      .admin`SELECT unmatched_at IS NULL AS active FROM matching.matches WHERE id = ${matchId}`;
    expect(match.active).toBe(true);
    const [photo] = await b.infra.admin`SELECT status FROM media.uploads WHERE id = ${photoId}`;
    expect(photo.status).not.toBe('deleted');
  }, 300_000);
});
