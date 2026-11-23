// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_TIMEOUT_MS } from '../../platform/helpers.js';
import { startBackend } from '../phase10/harness.js';

/**
 * Phase 14: revoked sessions. An access token stays valid for up to 15 minutes, so sensitive
 * user routes also check the session, and every admin request checks the admin session.
 */
describe('session revocation (Phase 14)', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;

  beforeAll(async () => {
    b = await startBackend();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  /**
   * The sensitive user routes and a request that calls each.
   * @param {{ publicId: string }} other
   * @returns {[string, string, Record<string, unknown>][]}
   */
  const sensitive = (other) => [
    ['GET', '/v1/me/export', {}],
    ['GET', '/v1/me/devices', {}],
    ['DELETE', '/v1/me/devices/01900000-0000-7000-8000-000000000000', {}],
    ['POST', '/v1/devices', { body: { pushToken: 'ExponentPushToken[abc]', platform: 'ios' } }],
    ['DELETE', `/v1/blocks/${other.publicId}`, {}],
    ['DELETE', '/v1/me', {}],
  ];

  it('a signed-out session cannot use sensitive routes, though its access token is still valid', async () => {
    const user = await b.signUp();
    const other = await b.signUp();
    expect((await b.call('GET', '/v1/me/export', { token: user.token })).status).toBe(200);
    const out = await b.call('POST', '/v1/auth/logout', { token: user.token, body: {} });
    expect(out.status).toBe(200);

    // Non-sensitive routes accept the token until it expires (stateless JWT, by design).
    expect((await b.call('GET', '/v1/me/profile', { token: user.token })).status).toBe(200);
    for (const [method, path, extra] of sensitive(other)) {
      const res = await b.call(/** @type {any} */ (method), /** @type {string} */ (path), {
        token: user.token,
        ...extra,
      });
      expect([path, res.status, res.body.error?.code]).toEqual([path, 401, 'UNAUTHENTICATED']);
    }
    // The account was not deleted by the refused call.
    const [row] = await b.infra.admin`SELECT status FROM identity.users WHERE id = ${user.id}`;
    expect(row.status).not.toBe('deleted');
  });

  it('a refresh keeps both the old and the new access token working; a device sign-out stops them', async () => {
    const user = await b.signUp();
    const refreshed = await b.call('POST', '/v1/auth/refresh', {
      body: { refreshToken: user.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    const fresh = refreshed.body.tokens.accessToken;
    expect((await b.call('GET', '/v1/me/devices', { token: user.token })).status).toBe(200);
    const devices = await b.call('GET', '/v1/me/devices', { token: fresh });
    expect(devices.status).toBe(200);

    const [device] = devices.body.items;
    const revoked = await b.call('DELETE', `/v1/me/devices/${device.id}`, { token: fresh });
    expect(revoked.status).toBe(200);
    for (const token of [user.token, fresh]) {
      expect((await b.call('GET', '/v1/me/export', { token })).status).toBe(401);
    }
  });

  it('deleting an account twice answers the same result (the repeat needs no live session)', async () => {
    const user = await b.signUp();
    const first = await b.call('DELETE', '/v1/me', { token: user.token });
    expect(first.status).toBe(202);
    const again = await b.call('DELETE', '/v1/me', { token: user.token });
    expect(again.status).toBe(202);
    expect(again.body).toEqual(first.body);
  });

  it('admin logout revokes the session at once; other sessions keep working', async () => {
    const admin = await b.createStaff('admin');
    const [first, second] = [await admin.login(), await admin.login()];
    expect((await b.call('GET', '/v1/admin/flags', { token: first })).status).toBe(200);

    const out = await b.call('POST', '/v1/admin/auth/logout', { token: first, body: {} });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ loggedOut: true });
    for (const [method, path] of [
      ['GET', '/v1/admin/flags'],
      ['GET', '/v1/admin/panels'],
      ['GET', '/v1/admin/audit-log'],
    ]) {
      const res = await b.call(/** @type {any} */ (method), path, { token: first });
      expect([path, res.status]).toEqual([path, 401]);
    }
    const put = await b.call('PUT', '/v1/admin/flags/test.revoked', {
      token: first,
      body: { enabled: true, rules: [] },
    });
    expect(put.status).toBe(401);
    // Idempotent, and the other session is untouched.
    expect((await b.call('POST', '/v1/admin/auth/logout', { token: first, body: {} })).status).toBe(
      200,
    );
    expect((await b.call('GET', '/v1/admin/flags', { token: second })).status).toBe(200);

    await expect
      .poll(
        async () =>
          (
            await b.infra.admin`SELECT action FROM admin.audit_log
              WHERE target_id = ${admin.id} ORDER BY created_at, id`
          ).map((r) => r.action),
        { timeout: 20_000 },
      )
      .toEqual(['admin.login', 'admin.login', 'admin.logout']);
  }, 120_000); // two sign-ins need two TOTP steps (30 s each)

  it('revoking every session of a staff member (or a session expiring) takes effect on the next request', async () => {
    const moderator = await b.createStaff('moderator');
    const token = await moderator.login();
    expect((await b.call('GET', '/v1/admin/reports', { token })).status).toBe(200);
    await b.infra.admin`UPDATE admin.sessions SET expires_at = now() - interval '1 second'
      WHERE admin_id = ${moderator.id}`;
    expect((await b.call('GET', '/v1/admin/reports', { token })).status).toBe(401);

    const again = await moderator.login();
    await b.infra.admin`UPDATE admin.sessions SET revoked_at = now()
      WHERE admin_id = ${moderator.id} AND revoked_at IS NULL`;
    expect((await b.call('GET', '/v1/admin/reports', { token: again })).status).toBe(401);
  }, 120_000);
});
