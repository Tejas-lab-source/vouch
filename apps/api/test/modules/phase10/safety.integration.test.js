// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, HOOK_TIMEOUT_MS } from '../../platform/helpers.js';
import { collect, COLLEGE_ID, startBackend, WAIT_MS } from './harness.js';

describe('safety part 2: reports, moderation, bans, ID-card reviews (Phase 10)', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;
  let adminToken = '';
  let moderatorToken = '';

  beforeAll(async () => {
    b = await startBackend();
    const [admin, moderator] = [await b.createStaff('admin'), await b.createStaff('moderator')];
    adminToken = await admin.login();
    moderatorToken = await moderator.login();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  /** @param {string} token @param {any} body */
  const report = (token, body) => b.call('POST', '/v1/reports', { token, body });

  it('a chat report keeps the last 20 messages; a profile report the card; staff read them only through the report', async () => {
    const [a, c] = [await b.signUp(), await b.signUp()];
    await b.completeProfile(c, { name: 'Kabir', gender: 1 });
    const conversationId = await b.match(a, c);
    const sa = await b.socket(a.token);
    for (let i = 1; i <= 22; i += 1) {
      const ack = await sa.emitWithAck('message.send', {
        conversationId,
        clientMsgId: randomUUID(),
        kind: 'text',
        body: `message ${i}`,
      });
      expect(ack.ok).toBe(true);
    }
    const filed = await report(c.token, {
      targetId: a.publicId,
      context: 'chat',
      reason: 'harassment',
      conversationId,
      note: 'keeps messaging',
    });
    expect(filed.status).toBe(201);
    expect(filed.body).toEqual({ reportId: expect.any(String), status: 'open' });
    const detail = await b.call('GET', `/v1/admin/reports/${filed.body.reportId}`, {
      token: moderatorToken,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.evidence.messages.map((/** @type {any} */ m) => m.body)).toEqual(
      Array.from({ length: 20 }, (_, i) => `message ${i + 3}`),
    );
    expect(detail.body.evidence.note).toBe('keeps messaging');
    expect(detail.body).toMatchObject({ reporterId: c.publicId, targetId: a.publicId });

    const profileReport = await report(a.token, {
      targetId: c.publicId,
      context: 'profile',
      reason: 'fake_profile',
    });
    const profileDetail = await b.call('GET', `/v1/admin/reports/${profileReport.body.reportId}`, {
      token: moderatorToken,
    });
    expect(profileDetail.body.evidence).toMatchObject({ card: { name: 'Kabir' }, messages: [] });
    // The staff alert email is sent by notifications' report.created.v1 consumer.
    await expect.poll(() => b.alerts.length, { timeout: 20_000 }).toBeGreaterThan(1);
    expect(b.alerts[0]).toMatchObject({ to: 'moderation@example.com' });
    expect(JSON.stringify(b.alerts)).not.toContain('message 3');
    expect(JSON.stringify(b.alerts)).not.toContain('Kabir');
    sa.disconnect();
  });

  it('a chat report about a conversation the reporter is not in is refused', async () => {
    const [a, c, outsider] = [await b.signUp(), await b.signUp(), await b.signUp()];
    const conversationId = await b.match(a, c);
    const res = await report(outsider.token, {
      targetId: a.publicId,
      context: 'chat',
      reason: 'spam',
      conversationId,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_A_MEMBER');
    const self = await report(a.token, {
      targetId: a.publicId,
      context: 'profile',
      reason: 'spam',
    });
    expect(self.status).toBe(400);
    const unknown = await report(a.token, {
      targetId: 'noSuchUserAtAll00000',
      context: 'profile',
      reason: 'spam',
    });
    expect(unknown.status).toBe(404);
  });

  it('3 distinct reporters within 7 days hide the profile; 2 do not; one person reporting 3 times does not', async () => {
    const target = await b.signUp();
    await b.completeProfile(target);
    const reporters = [await b.signUp(), await b.signUp(), await b.signUp()];
    const status = async () =>
      (await b.infra.admin`SELECT status FROM profiles.profiles WHERE user_id = ${target.id}`)[0]
        ?.status;
    for (let i = 0; i < 3; i += 1) {
      await report(reporters[0]?.token ?? '', {
        targetId: target.publicId,
        context: 'profile',
        reason: 'spam',
      });
    }
    await report(reporters[1]?.token ?? '', {
      targetId: target.publicId,
      context: 'profile',
      reason: 'spam',
    });
    expect(await status()).toBe('active');
    await report(reporters[2]?.token ?? '', {
      targetId: target.publicId,
      context: 'profile',
      reason: 'spam',
    });
    expect(await status()).toBe('hidden');
    // Staff unhide through the report: the profile is active again (it is complete).
    const [{ id }] = await b.infra
      .admin`SELECT id FROM safety.reports WHERE target_id = ${target.id} AND status = 'open' LIMIT 1`;
    const acted = await b.call('POST', `/v1/admin/reports/${id}/actions`, {
      token: moderatorToken,
      body: { action: 'unhide', note: 'reviewed, fine' },
    });
    expect(acted.status).toBe(200);
    expect(acted.body.status).toBe('actioned');
    expect(await status()).toBe('active');
    const again = await b.call('POST', `/v1/admin/reports/${id}/actions`, {
      token: moderatorToken,
      body: { action: 'dismiss', note: 'twice' },
    });
    expect(again.status).toBe(409);
  });

  it('a ban revokes sessions, removes the user from decks and closes conversations within one consumer cycle', async () => {
    const [bad, other, viewer] = [await b.signUp(), await b.signUp(), await b.signUp()];
    await b.completeProfile(bad);
    await b.completeProfile(viewer, { gender: 1 });
    const conversationId = await b.match(bad, other);
    const otherSocket = await b.socket(other.token);
    const closed = collect(otherSocket, 'conversation.closed');
    // The viewer's deck shows the user before the ban.
    await eventually(async () => {
      const deck = await b.call('GET', '/v1/deck', { token: viewer.token });
      return deck.body?.cards?.some((/** @type {any} */ c) => c.userId === bad.publicId) || null;
    }, WAIT_MS);

    const ban = await b.call('POST', '/v1/admin/bans', {
      token: adminToken,
      body: { userId: bad.publicId, reason: 'harassment' },
    });
    expect(ban.status).toBe(201);
    const started = Date.now();
    await eventually(async () => {
      const [u] = await b.infra.admin`SELECT status FROM identity.users WHERE id = ${bad.id}`;
      const [c] = await b.infra
        .admin`SELECT closed_at FROM chat.conversations WHERE id = ${conversationId}`;
      return u?.status === 'banned' && c?.closed_at ? true : null;
    }, WAIT_MS);
    const seconds = (Date.now() - started) / 1000;
    expect(seconds).toBeLessThan(15);
    const sessions = await b.infra.admin`SELECT count(*)::int AS n FROM identity.auth_sessions
      WHERE user_id = ${bad.id} AND revoked_at IS NULL`;
    expect(sessions[0]?.n).toBe(0);
    const refresh = await b.call('POST', '/v1/auth/refresh', {
      body: { refreshToken: bad.refreshToken },
    });
    expect(refresh.status).toBe(401);
    // The other person is told "unmatched", exactly as for an ordinary unmatch.
    await expect.poll(() => closed.length, { timeout: 10_000 }).toBe(1);
    expect(closed[0]).toEqual({ conversationId, reason: 'unmatched' });
    const deck = await b.call('GET', '/v1/deck', { token: viewer.token });
    expect(deck.body.cards.some((/** @type {any} */ c) => c.userId === bad.publicId)).toBe(false);
    expect(
      (
        await b.call('POST', '/v1/admin/bans', {
          token: adminToken,
          body: { userId: bad.publicId, reason: 'again' },
        })
      ).status,
    ).toBe(409);

    // Lifting the ban reactivates the account (matches stay ended).
    const lifted = await b.call('POST', `/v1/admin/bans/${ban.body.banId}/lift`, {
      token: adminToken,
      body: {},
    });
    expect(lifted.body.liftedAt).toEqual(expect.any(String));
    await eventually(async () => {
      const [u] = await b.infra.admin`SELECT status FROM identity.users WHERE id = ${bad.id}`;
      return u?.status === 'active' || null;
    }, WAIT_MS);
    const [m] = await b.infra
      .admin`SELECT unmatched_at FROM matching.matches WHERE id = ${conversationId}`;
    expect(m?.unmatched_at).not.toBeNull();
    otherSocket.disconnect();
  });

  it('ID-card fallback: any email, pending_review until staff approve the ID and selfie', async () => {
    const student = await b.signUp({
      email: `student-${randomUUID().slice(0, 6)}@gmail.example.com`,
      verification: 'id_card',
      collegeId: COLLEGE_ID,
    });
    expect(student.status).toBe('pending_review');
    const blocked = await b.call('PATCH', '/v1/me/profile', {
      token: student.token,
      body: { name: 'Riya' },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_PENDING_REVIEW');
    // No deck, no chat socket; the config and its own devices still work.
    expect((await b.call('GET', '/v1/deck', { token: student.token })).body.error.code).toBe(
      'ACCOUNT_PENDING_REVIEW',
    );
    await expect(b.socket(student.token)).rejects.toMatchObject({
      data: { code: 'ACCOUNT_PENDING_REVIEW' },
    });
    expect((await b.call('GET', '/v1/config', { token: student.token })).status).toBe(200);
    expect((await b.call('GET', '/v1/me/devices', { token: student.token })).status).toBe(200);

    const bytes = Buffer.from('fake-jpeg-bytes-for-an-id-card');
    const uploads = await b.call('POST', '/v1/verification/id-card/uploads', {
      token: student.token,
      body: {
        idCard: { contentType: 'image/jpeg', sizeBytes: bytes.length },
        selfie: { contentType: 'image/jpeg', sizeBytes: bytes.length },
      },
    });
    expect(uploads.status).toBe(201);
    const early = await b.call('POST', '/v1/verification/id-card', {
      token: student.token,
      body: { submissionId: uploads.body.submissionId },
    });
    expect(early.body.error.code).toBe('UPLOAD_NOT_UPLOADED');
    for (const target of [uploads.body.idCard, uploads.body.selfie]) {
      expect(new URL(target.url).pathname).toContain('/verification/');
      const put = await fetch(target.url, { method: 'PUT', headers: target.headers, body: bytes });
      expect(put.status).toBe(200);
    }
    const submitted = await b.call('POST', '/v1/verification/id-card', {
      token: student.token,
      body: { submissionId: uploads.body.submissionId },
    });
    expect(submitted.status).toBe(201);
    const twice = await b.call('POST', '/v1/verification/id-card', {
      token: student.token,
      body: { submissionId: uploads.body.submissionId },
    });
    expect(twice.body).toEqual({ status: 'pending' });

    const queue = await b.call('GET', '/v1/admin/verification-reviews', { token: moderatorToken });
    const item = queue.body.items.find((/** @type {any} */ r) => r.userId === student.publicId);
    expect(item).toMatchObject({ status: 'pending', decidedAt: null });
    expect((await fetch(item.idImageUrl)).status).toBe(200);
    expect((await fetch(item.selfieImageUrl)).status).toBe(200);
    // The images are private: the public CDN base does not serve them.
    const key = new URL(item.idImageUrl).pathname.split('/vouch/')[1];
    expect((await fetch(`${b.s3.publicBaseUrl}/${key}`)).status).toBeGreaterThanOrEqual(400);

    const decided = await b.call(
      'POST',
      `/v1/admin/verification-reviews/${item.reviewId}/decision`,
      {
        token: moderatorToken,
        body: { decision: 'approve' },
      },
    );
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('approved');
    await eventually(async () => {
      const [u] = await b.infra.admin`SELECT status FROM identity.users WHERE id = ${student.id}`;
      return u?.status === 'active' || null;
    }, WAIT_MS);
    // The old access token still carries the pending-review claim; a refresh drops it.
    const stale = await b.call('PATCH', '/v1/me/profile', {
      token: student.token,
      body: { name: 'Riya' },
    });
    expect(stale.status).toBe(403);
    const refreshed = await b.call('POST', '/v1/auth/refresh', {
      body: { refreshToken: student.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    const allowed = await b.call('PATCH', '/v1/me/profile', {
      token: refreshed.body.tokens.accessToken,
      body: { name: 'Riya' },
    });
    expect(allowed.body).toMatchObject({ name: 'Riya' });
    expect(allowed.status).toBe(200);
  });

  it('photos the provider flags wait in the review queue; staff approve or reject them', async () => {
    const user = await b.signUp();
    b.moderation.verdict = 'review';
    const held = await b.uploadPhoto(user.token);
    await b.uploadReaches(held, 'in_review');
    const rejectMe = await b.uploadPhoto(user.token);
    await b.uploadReaches(rejectMe, 'in_review');
    b.moderation.verdict = 'approve';

    const queue = await b.call('GET', '/v1/admin/photo-reviews?limit=50', {
      token: moderatorToken,
    });
    const ids = queue.body.items.map((/** @type {any} */ p) => p.photoId);
    expect(ids).toEqual(expect.arrayContaining([held, rejectMe]));
    const one = queue.body.items.find((/** @type {any} */ p) => p.photoId === held);
    expect(one.userId).toBe(user.publicId);
    expect((await fetch(one.urls.w400)).status).toBe(200);

    const approved = await b.call('POST', `/v1/admin/photo-reviews/${held}/decision`, {
      token: moderatorToken,
      body: { decision: 'approve' },
    });
    expect(approved.body).toEqual({ photoId: held, status: 'approved' });
    await b.uploadReaches(held, 'approved');
    const rejected = await b.call('POST', `/v1/admin/photo-reviews/${rejectMe}/decision`, {
      token: moderatorToken,
      body: { decision: 'reject' },
    });
    expect(rejected.body.status).toBe('rejected');
    const twice = await b.call('POST', `/v1/admin/photo-reviews/${held}/decision`, {
      token: moderatorToken,
      body: { decision: 'reject' },
    });
    expect(twice.status).toBe(409);
  });

  it('three moderation rejections in 30 days open one system report', async () => {
    const user = await b.signUp();
    b.moderation.verdict = 'reject';
    for (let i = 0; i < 4; i += 1) {
      await b.uploadReaches(await b.uploadPhoto(user.token), 'rejected');
    }
    b.moderation.verdict = 'approve';
    const reports = await eventually(async () => {
      const rows = await b.infra
        .admin`SELECT reason, reporter_id, evidence FROM safety.reports WHERE target_id = ${user.id}`;
      return rows.length > 0 ? rows : null;
    }, WAIT_MS);
    // Give a late consumer the chance to file a second one, then check there is exactly one.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rows = await b.infra
      .admin`SELECT reason FROM safety.reports WHERE target_id = ${user.id}`;
    expect(rows).toHaveLength(1);
    expect(reports[0]?.reason).toBe('inappropriate_content');
    const queue = await b.call('GET', '/v1/admin/reports?limit=50', { token: moderatorToken });
    const item = queue.body.items.find((/** @type {any} */ r) => r.targetId === user.publicId);
    expect(item).toMatchObject({ context: 'profile', reason: 'inappropriate_content' });
  });
});
