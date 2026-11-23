// @ts-check
import { randomUUID } from 'node:crypto';
import { ENDPOINTS } from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConsistencyCheck } from '../../../src/platform/jobs/consistency.js';
import { eventually, HOOK_TIMEOUT_MS } from '../../platform/helpers.js';
import { collect, startBackend, WAIT_MS } from './harness.js';

describe('full backend scenario: sign-up → profile → photos → deck → match → chat → push → report → ban', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;
  /** @type {string[]} */
  const log = [];
  /** @param {string} line */
  const step = (line) => void log.push(line);

  beforeAll(async () => {
    b = await startBackend();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    process.stdout.write(`PHASE10_SCENARIO\n${log.map((l) => `  ${l}`).join('\n')}\n`);
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  it('runs end to end through HTTP and sockets', async () => {
    const admin = await b.createStaff('admin');
    const adminToken = await admin.login();

    // 1. Sign-up (college email OTP) and complete profiles with approved photos.
    const asha = await b.signUp();
    const kabir = await b.signUp();
    step(`sign-up: asha ${asha.status}, kabir ${kabir.status}`);
    await b.completeProfile(asha, { name: 'Asha', gender: 0, interestedIn: [1] });
    await b.completeProfile(kabir, { name: 'Kabir', gender: 1, interestedIn: [0] });
    step('profiles: both active with 2 approved photos each');
    const pushAsha = `ExponentPushToken[asha-${randomUUID()}]`;
    await b.registerPush(asha.token, pushAsha);

    // 2. Decks: each sees the other (no shortcuts: served through the real deck).
    const deckHas = async (/** @type {any} */ viewer, /** @type {any} */ target) =>
      eventually(async () => {
        const deck = await b.call('GET', '/v1/deck', { token: viewer.token });
        return (
          deck.body?.cards?.find((/** @type {any} */ c) => c.userId === target.publicId) ?? null
        );
      }, WAIT_MS);
    // 3. Mutual like → one match; each swipes right after the card is served, as a client does.
    expect((await deckHas(asha, kabir)).name).toBe('Kabir');
    const first = await b.call('POST', '/v1/swipes', {
      token: asha.token,
      body: { swipeId: randomUUID(), targetId: kabir.publicId, direction: 'like' },
    });
    expect(first.body).toEqual({ matched: false, matchId: null });
    expect((await deckHas(kabir, asha)).name).toBe('Asha');
    step('deck: asha sees Kabir and likes; kabir sees Asha');
    const kabirSocket = await b.socket(kabir.token);
    const matchNew = collect(kabirSocket, 'match.new');
    const second = await b.call('POST', '/v1/swipes', {
      token: kabir.token,
      body: { swipeId: randomUUID(), targetId: asha.publicId, direction: 'like' },
    });
    expect(second.body.matched).toBe(true);
    const matchId = second.body.matchId;
    await expect.poll(() => matchNew.length, { timeout: 20_000 }).toBe(1);
    step(`match: ${matchId.slice(0, 8)}…, match.new on kabir's socket`);

    // 4. Push to the first liker (asha is offline).
    await eventually(
      () => b.pushes.some((p) => p.token === pushAsha && p.data.type === 'match.new') || null,
      WAIT_MS,
    );
    step('push: match.new to asha (first liker)');

    // 5. Chat: kabir writes while asha is offline → one message push, no body.
    for (const body of ['hi Asha', 'coffee on Friday?']) {
      const ack = await kabirSocket.emitWithAck('message.send', {
        conversationId: matchId,
        clientMsgId: randomUUID(),
        kind: 'text',
        body,
      });
      expect(ack.ok).toBe(true);
    }
    await eventually(
      () => b.pushes.some((p) => p.token === pushAsha && p.data.type === 'message.new') || null,
      WAIT_MS,
    );
    expect(JSON.stringify(b.pushes)).not.toContain('coffee');
    step('chat: 2 messages; push message.new to asha (batched, no body)');

    // 6. Asha reads the history and reports kabir from the chat.
    const history = await b.call('GET', `/v1/conversations/${matchId}/messages`, {
      token: asha.token,
    });
    expect(history.body.items.map((/** @type {any} */ m) => m.body)).toEqual([
      'hi Asha',
      'coffee on Friday?',
    ]);
    const report = await b.call('POST', '/v1/reports', {
      token: asha.token,
      body: {
        targetId: kabir.publicId,
        context: 'chat',
        reason: 'harassment',
        conversationId: matchId,
      },
    });
    expect(report.status).toBe(201);
    await expect.poll(() => b.alerts.length, { timeout: 20_000 }).toBe(1);
    step(`report: ${report.body.reportId.slice(0, 8)}… open; staff alerted by email (ids only)`);

    // 7. Staff ban kabir through the report.
    const ashaSocket = await b.socket(asha.token);
    const closed = collect(ashaSocket, 'conversation.closed');
    const kabirClosed = collect(kabirSocket, 'conversation.closed');
    const acted = await b.call('POST', `/v1/admin/reports/${report.body.reportId}/actions`, {
      token: adminToken,
      body: { action: 'ban', note: 'harassment confirmed' },
    });
    expect(acted.status).toBe(200);
    expect(acted.body).toMatchObject({
      status: 'actioned',
      evidence: { messages: [{ body: 'hi Asha' }, { body: 'coffee on Friday?' }] },
    });
    await expect.poll(() => closed.length, { timeout: 20_000 }).toBe(1);
    expect(closed[0]).toEqual({ conversationId: matchId, reason: 'unmatched' });
    expect(kabirClosed[0]).toEqual({ conversationId: matchId, reason: 'banned' });
    await eventually(async () => {
      const [u] = await b.infra.admin`SELECT status FROM identity.users WHERE id = ${kabir.id}`;
      return u?.status === 'banned' || null;
    }, WAIT_MS);
    const refresh = await b.call('POST', '/v1/auth/refresh', {
      body: { refreshToken: kabir.refreshToken },
    });
    // The ban revoked every session, so the refresh token is simply invalid now.
    expect(refresh.status).toBe(401);
    expect(refresh.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    const deck = await b.call('GET', '/v1/deck', { token: asha.token });
    expect(deck.body.cards.some((/** @type {any} */ c) => c.userId === kabir.publicId)).toBe(false);
    const send = await ashaSocket.emitWithAck('message.send', {
      conversationId: matchId,
      clientMsgId: randomUUID(),
      kind: 'text',
      body: 'still there?',
    });
    expect(send.error.code).toBe('CONVERSATION_CLOSED');
    step(
      'ban: kabir banned (sessions revoked, refresh 401); asha told "unmatched", kabir "banned"; out of decks; sending refused',
    );
    // The ban and the report's resolution are each audited in their own transaction (ADR 0025).
    const audit = (await b.auditRowsAtLeast(3)).map((r) => r.action);
    expect(audit).toEqual(['admin.login', 'ban.create', 'report.ban']);
    step(`audit: ${audit.join(', ')}`);
    kabirSocket.disconnect();
    ashaSocket.disconnect();
  }, 300_000);

  it('every endpoint in the contracts (openapi.json) is registered', () => {
    const missing = ENDPOINTS.filter(
      (e) =>
        !b.app.http.hasRoute({
          method: e.method,
          url: e.path.replace(/\{([a-zA-Z]+)\}/g, ':$1'),
        }),
    ).map((e) => `${e.method} ${e.path}`);
    expect(missing).toEqual([]);
    step(`routes: all ${ENDPOINTS.length} contract endpoints registered`);
  });

  it('account deletion leaves no rows in any module (except anonymised matches); the consistency job agrees', async () => {
    const [x, y] = [await b.signUp(), await b.signUp()];
    const matchId = await b.match(x, y);
    const sx = await b.socket(x.token);
    await sx.emitWithAck('message.send', {
      conversationId: matchId,
      clientMsgId: randomUUID(),
      kind: 'text',
      body: 'bye',
    });
    sx.disconnect();
    await b.registerPush(x.token, `ExponentPushToken[x-${randomUUID()}]`);
    await b.call('PUT', '/v1/me/notification-prefs', {
      token: x.token,
      body: {
        pushMatches: true,
        pushMessages: false,
        pushLikesDigest: true,
        quietHours: null,
        timezone: 'Asia/Kolkata',
      },
    });
    await b.call('POST', '/v1/blocks', {
      token: x.token,
      body: { targetId: (await b.signUp()).publicId },
    });

    const deleted = await b.call('DELETE', '/v1/me', { token: x.token });
    expect(deleted.status).toBeLessThan(300);
    const consumers = [...(b.app.boot.subscriptions.get('user.deleted.v1') ?? [])].sort();
    expect(consumers).toEqual(['chat', 'matching', 'media', 'notifications', 'profiles', 'safety']);
    await eventually(async () => {
      const rows = await b.infra.admin`SELECT module FROM platform.deletion_tasks
        WHERE user_id = ${x.id} AND completed_at IS NOT NULL`;
      return rows.length === consumers.length || null;
    }, WAIT_MS);
    step(`deletion: every consumer finished (${consumers.join(', ')})`);

    // Run the nightly check as if 25 hours had passed.
    const later = { now: () => new Date(Date.now() + 25 * 3600 * 1000) };
    const check = createConsistencyCheck({
      db: b.app.platform.db,
      logger: b.app.platform.logger,
      metrics: b.app.platform.metrics,
      clock: later,
      subscriptions: b.app.boot.subscriptions,
    });
    const counts = await check();
    expect(counts).toEqual({
      matches_without_conversation: 0,
      conversations_without_match: 0,
      deleted_users_with_data: 0,
      deletions_overdue: 0,
    });
    const [match] = await b.infra
      .admin`SELECT user_low, user_high, anonymised_at FROM matching.matches WHERE id = ${matchId}`;
    expect(match?.anonymised_at).not.toBeNull();
    expect([match?.user_low, match?.user_high]).not.toContain(x.id);
    step(`consistency: ${JSON.stringify(counts)}`);

    // The check finds a broken invariant: a conversation without a match.
    const stray = b.app.platform.newId();
    const [low, high] = [x.id, y.id].sort();
    await b.infra.admin`INSERT INTO chat.conversations (id, match_id, user_low, user_high)
      VALUES (${stray}, ${stray}, ${low}, ${high})`;
    const broken = await check();
    expect(broken.conversations_without_match).toBe(1);
    const metrics = await b.app.platform.metrics.registry.metrics();
    expect(metrics).toContain(
      'vouch_consistency_violations{check="conversations_without_match"} 1',
    );

    // Overdue deletions: an unfinished module shows up for staff after 24 hours.
    const admin = await b.createStaff('admin');
    const token = await admin.login();
    await b.infra
      .admin`UPDATE identity.users SET deleted_at = now() - interval '2 days' WHERE id = ${x.id}`;
    expect((await b.call('GET', '/v1/admin/deletions/overdue', { token })).body.items).toEqual([]);
    await b.infra
      .admin`DELETE FROM platform.deletion_tasks WHERE user_id = ${x.id} AND module = 'chat'`;
    const overdue = await b.call('GET', '/v1/admin/deletions/overdue', { token });
    expect(overdue.body.items).toEqual([
      { userId: x.publicId, deletedAt: expect.any(String), pendingConsumers: ['chat'] },
    ]);
    step('overdue deletions: listed only when a module has not finished');
  }, 300_000);
});
