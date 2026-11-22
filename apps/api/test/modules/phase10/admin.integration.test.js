// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_TIMEOUT_MS } from '../../platform/helpers.js';
import { collect, startBackend } from './harness.js';

describe('admin backend: sign-in, roles, audit, flags, panels (Phase 10)', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;
  /** @type {Awaited<ReturnType<Awaited<ReturnType<typeof startBackend>>['createStaff']>>} */
  let admin;
  /** @type {Awaited<ReturnType<Awaited<ReturnType<typeof startBackend>>['createStaff']>>} */
  let moderator;
  let adminToken = '';
  let moderatorToken = '';

  beforeAll(async () => {
    b = await startBackend();
    [admin, moderator] = [await b.createStaff('admin'), await b.createStaff('moderator')];
    adminToken = await admin.login();
    moderatorToken = await moderator.login();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  it('sign-in needs the right password and the current code; every failure looks the same', async () => {
    const wrongPassword = await b.call('POST', '/v1/admin/auth/login', {
      body: { email: admin.email, password: 'not it at all', totp: await admin.code() },
    });
    const wrongCode = await b.call('POST', '/v1/admin/auth/login', {
      body: { email: admin.email, password: admin.password, totp: '000000' },
    });
    const unknown = await b.call('POST', '/v1/admin/auth/login', {
      body: { email: 'nobody@staff.example.com', password: admin.password, totp: '123456' },
    });
    for (const res of [wrongPassword, wrongCode, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'The email, password or code is wrong.',
      });
    }
  }, 70_000);

  it('a TOTP code is accepted once (replay refused)', async () => {
    const code = await moderator.code();
    const first = await b.call('POST', '/v1/admin/auth/login', {
      body: { email: moderator.email, password: moderator.password, totp: code },
    });
    expect(first.status).toBe(200);
    expect(first.body.admin).toEqual({ displayName: expect.any(String), role: 'moderator' });
    const replay = await b.call('POST', '/v1/admin/auth/login', {
      body: { email: moderator.email, password: moderator.password, totp: code },
    });
    expect(replay.status).toBe(401);
  }, 70_000);

  it('a user token, an admin token without MFA, and no token are all refused', async () => {
    const user = await b.signUp();
    expect((await b.call('GET', '/v1/admin/reports', { token: user.token })).status).toBe(401);
    const noMfa = await b.keys.sign({ sub: admin.id }, { audience: 'vouch:admin' });
    const res = await b.call('GET', '/v1/admin/reports', { token: noMfa });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    expect((await b.call('GET', '/v1/admin/reports')).status).toBe(401);
  });

  it('a disabled account is refused at once, even with a valid token', async () => {
    const staff = await b.createStaff('moderator');
    const token = await staff.login();
    expect((await b.call('GET', '/v1/admin/reports', { token })).status).toBe(200);
    await b.infra.admin`UPDATE admin.admin_users SET status = 'disabled' WHERE id = ${staff.id}`;
    expect((await b.call('GET', '/v1/admin/reports', { token })).status).toBe(401);
  }, 70_000);

  it('moderators cannot use admin-only routes', async () => {
    const forbidden = [
      ['GET', '/v1/admin/audit-log'],
      ['GET', '/v1/admin/flags'],
      ['GET', '/v1/admin/deletions/overdue'],
    ];
    for (const [method, path] of forbidden) {
      expect((await b.call(method, path, { token: moderatorToken })).status).toBe(403);
    }
    const target = await b.signUp();
    const ban = await b.call('POST', '/v1/admin/bans', {
      token: moderatorToken,
      body: { userId: target.publicId, reason: 'spam' },
    });
    expect(ban.status).toBe(403);
  });

  it('panels come from module manifests, filtered by role', async () => {
    const forAdmin = await b.call('GET', '/v1/admin/panels', { token: adminToken });
    const forModerator = await b.call('GET', '/v1/admin/panels', { token: moderatorToken });
    const ids = (/** @type {any} */ r) => r.body.items.map((/** @type {any} */ p) => p.id).sort();
    expect(ids(forAdmin)).toEqual([
      'admin.audit-log',
      'admin.deletions',
      'admin.flags',
      'safety.bans',
      'safety.photo-reviews',
      'safety.reports',
      'safety.verification-reviews',
    ]);
    expect(ids(forModerator)).toEqual([
      'safety.photo-reviews',
      'safety.reports',
      'safety.verification-reviews',
    ]);
  });

  it('a flag edit is stored, audited, broadcast as config.changed and visible in GET /v1/config', async () => {
    const user = await b.signUp();
    const socket = await b.socket(user.token);
    const changed = collect(socket, 'config.changed');
    const before = await b.call('GET', '/v1/config', { token: user.token });
    expect(before.status).toBe(200);
    expect(before.body.flags['chat.links']).toBeUndefined();
    expect(before.body.college).toMatchObject({ name: 'Northfield Institute' });
    const put = await b.call('PUT', '/v1/admin/flags/chat.links', {
      token: adminToken,
      body: { enabled: true, rules: [] },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ key: 'chat.links', enabled: true, rules: [] });
    await expect.poll(() => changed.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const after = await b.call('GET', '/v1/config', { token: user.token });
    expect(after.body.flags['chat.links']).toBe(true);
    const signedOut = await b.call('GET', '/v1/config');
    expect(signedOut.status).toBe(200);
    expect(signedOut.body.college).toBeNull();
    const listed = await b.call('GET', '/v1/admin/flags', { token: adminToken });
    expect(listed.body.items.map((/** @type {any} */ f) => f.key)).toContain('chat.links');
    socket.disconnect();
  });

  it('every admin action writes exactly one audit entry, with no notes or personal data', async () => {
    const target = await b.signUp();
    const other = await b.signUp();
    await b.call('POST', '/v1/blocks', { token: target.token, body: { targetId: other.publicId } });
    const start = (await b.auditRows()).length;

    const ban = await b.call('POST', '/v1/admin/bans', {
      token: adminToken,
      body: { userId: target.publicId, reason: 'harassment, note with a name: Asha' },
    });
    expect(ban.status).toBe(201);
    const lift = await b.call('POST', `/v1/admin/bans/${ban.body.banId}/lift`, {
      token: adminToken,
      body: {},
    });
    expect(lift.status).toBe(200);
    const again = await b.call('POST', `/v1/admin/bans/${ban.body.banId}/lift`, {
      token: adminToken,
      body: {},
    });
    expect(again.status).toBe(200);
    const unblock = await b.call('POST', `/v1/admin/users/${target.publicId}/unblock`, {
      token: adminToken,
      body: { otherUserId: other.publicId, note: 'blocked by mistake' },
    });
    expect(unblock.body).toEqual({ unblocked: true });

    const rows = (await b.auditRows()).slice(start);
    expect(rows.map((r) => r.action)).toEqual([
      'ban.create',
      'ban.lift',
      'ban.lift',
      'block.remove',
    ]);
    expect(JSON.stringify(rows)).not.toContain('Asha');
    expect(JSON.stringify(rows)).not.toContain('mistake');

    const log = await b.call(
      'GET',
      `/v1/admin/audit-log?targetType=user&targetId=${target.publicId}`,
      {
        token: adminToken,
      },
    );
    expect(log.status).toBe(200);
    expect(log.body.items.map((/** @type {any} */ e) => e.action)).toEqual([
      'block.remove',
      'ban.create',
    ]);
    expect(log.body.items[0].actorName).toMatch(/^admin /);
    // Reads are not actions: they write nothing.
    const count = (await b.auditRows()).length;
    await b.call('GET', '/v1/admin/reports', { token: adminToken });
    await b.call('GET', `/v1/admin/users/${target.publicId}`, { token: adminToken });
    expect((await b.auditRows()).length).toBe(count);
  });

  it('looks a user up by public id', async () => {
    const user = await b.signUp();
    // The profile row is created by profiles' user.created.v1 consumer, shortly after sign-up.
    await expect
      .poll(
        async () =>
          (await b.call('GET', `/v1/admin/users/${user.publicId}`, { token: moderatorToken })).body
            .profileStatus,
        { timeout: 20_000 },
      )
      .toBe('pending');
    const res = await b.call('GET', `/v1/admin/users/${user.publicId}`, { token: moderatorToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: user.publicId,
      status: 'active',
      profileStatus: 'pending',
      collegeName: 'Northfield Institute',
      reportsReceived: 0,
      activeBan: null,
    });
    expect(
      (await b.call('GET', '/v1/admin/users/unknownUserId000000', { token: adminToken })).status,
    ).toBe(404);
  });
});
