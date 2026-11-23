// @ts-check
import { randomUUID } from 'node:crypto';
import {
  CLIENT_EVENTS,
  listConversations as listConversationsEndpoint,
  listMessages as listMessagesEndpoint,
  SERVER_EVENTS,
} from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, HOOK_TIMEOUT_MS } from '../../platform/helpers.js';
import { collect, startChatStack } from './harness.js';

const WAIT_MS = 20_000;
const sendAck = new Map(Object.entries(CLIENT_EVENTS)).get('message.send')?.ack;
const newMessage = new Map(Object.entries(SERVER_EVENTS)).get('message.new')?.payload;

describe('chat across two gateways (ROLE=ws ×2, one Redis)', () => {
  /** @type {Awaited<ReturnType<typeof startChatStack>>} */
  let stack;
  /** @type {any[]} */
  const sockets = [];
  /** @param {any} runtime @param {any} user @param {{ token?: string }} [o] */
  const open = async (runtime, user, o) => {
    const socket = await stack.socketFor(runtime, user, o);
    sockets.push(socket);
    return socket;
  };
  /** @param {any} socket @param {string} conversationId @param {string} body @param {string} [clientMsgId] */
  const send = (socket, conversationId, body, clientMsgId = randomUUID()) =>
    stack.ask(socket, 'message.send', { conversationId, clientMsgId, kind: 'text', body });

  beforeAll(async () => {
    stack = await startChatStack({
      RATE_LIMIT_MESSAGES_MINUTE: '40',
      SOCKET_REFRESH_GRACE_SECONDS: '1',
    });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await stack?.stop();
  }, HOOK_TIMEOUT_MS);

  it('a message sent on gateway A reaches the recipient on gateway B (and the sender’s other device)', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    const senderSocket = await open(stack.gatewayA, a);
    const senderOtherDevice = await open(stack.gatewayB, a);
    const recipientSocket = await open(stack.gatewayB, b);
    const inbox = collect(recipientSocket, 'message.new');
    const otherDevice = collect(senderOtherDevice, 'message.new');
    const ack = await send(senderSocket, conversationId, 'hello across gateways');
    expect(sendAck?.parse(ack)).toMatchObject({ ok: true, seq: 1 });
    await eventually(() => inbox.length === 1 && otherDevice.length === 1, WAIT_MS);
    expect(newMessage?.parse(inbox[0])).toMatchObject({
      conversationId,
      seq: 1,
      senderId: a.public_id,
      body: 'hello across gateways',
    });
    // History over REST, in seq order.
    await send(senderSocket, conversationId, 'second');
    const history = await stack.rest(
      b,
      `/v1/conversations/${conversationId}/messages?afterSeq=0&limit=1`,
    );
    expect(listMessagesEndpoint.response.schema.parse(history.body)).toMatchObject({
      items: [{ seq: 1 }],
      nextAfterSeq: 1,
    });
    const inboxList = await stack.rest(b, '/v1/conversations');
    const parsed = listConversationsEndpoint.response.schema.parse(inboxList.body);
    expect(parsed.items[0]).toMatchObject({
      conversationId,
      matchId: conversationId,
      closed: false,
      lastMessage: { seq: 2, body: 'second' },
      lastReadSeq: 0,
    });
    // Read cursors move forward only and never past the last message.
    recipientSocket.emit('message.read', { conversationId, seq: 99 });
    await eventually(
      async () => (await stack.rest(b, '/v1/conversations')).body.items[0].lastReadSeq === 2,
      WAIT_MS,
    );
    recipientSocket.emit('message.read', { conversationId, seq: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect((await stack.rest(b, '/v1/conversations')).body.items[0].lastReadSeq).toBe(2);
  });

  it('match.new reaches both users (worker → Redis emitter → gateways)', async () => {
    const [a, b] = [stack.fresh(), stack.fresh()];
    const socketA = await open(stack.gatewayA, a);
    const socketB = await open(stack.gatewayB, b);
    const [newA, newB] = [collect(socketA, 'match.new'), collect(socketB, 'match.new')];
    const redis = stack.app.platform.redis.command;
    await redis.sadd(`discovery:served:${a.id}`, b.id);
    await redis.sadd(`discovery:served:${b.id}`, a.id);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      await stack.rest(from, '/v1/swipes', 'POST', {
        swipeId: randomUUID(),
        targetId: to.public_id,
        direction: 'like',
      });
    }
    await eventually(() => newA.length === 1 && newB.length === 1, WAIT_MS);
    expect(newA[0]).toMatchObject({
      conversationId: newA[0].matchId,
      user: { userId: b.public_id },
    });
    expect(newB[0].user.userId).toBe(a.public_id);
  });

  it('handshake needs a valid user token; payloads are validated; refresh cannot switch users', async () => {
    await expect(
      stack.socketFor(stack.gatewayA, stack.fresh(), { token: 'not-a-token' }),
    ).rejects.toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
    const user = stack.fresh();
    const socket = await open(stack.gatewayA, user);
    expect(await stack.ask(socket, 'message.send', { conversationId: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    const other = await stack.token(stack.fresh());
    expect(await stack.ask(socket, 'auth.refresh', { token: other })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('auth.refresh keeps a socket alive past its first token; without it, auth.expired then disconnect', async () => {
    const user = stack.fresh();
    const refreshed = await open(stack.gatewayA, user, {
      token: await stack.token(user, { expiresIn: '2s' }),
    });
    const expiring = await open(stack.gatewayA, user, {
      token: await stack.token(user, { expiresIn: '2s' }),
    });
    const expired = collect(expiring, 'auth.expired');
    const ack = /** @type {any} */ (
      await stack.ask(refreshed, 'auth.refresh', { token: await stack.token(user) })
    );
    expect(ack.ok).toBe(true);
    expect(Date.parse(ack.expiresAt)).toBeGreaterThan(Date.now() + 10 * 60_000);
    // Token expiry (2 s) plus the 1 s grace used here has passed.
    await eventually(() => !expiring.connected, 10_000);
    expect(expired).toEqual([{ reason: 'token_expired' }]);
    await new Promise((r) => setTimeout(r, 1500));
    expect(refreshed.connected).toBe(true);
  });

  it('sync replays every missed message in seq order after a disconnect', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    const sender = await open(stack.gatewayA, a);
    for (let i = 1; i <= 5; i += 1) await send(sender, conversationId, `m${i}`);
    const recipient = await open(stack.gatewayB, b);
    const replay = /** @type {any} */ (
      await stack.ask(recipient, 'sync', { cursors: [{ conversationId, lastSeq: 2 }] })
    );
    expect(replay.ok).toBe(true);
    expect(replay.messages.map((/** @type {any} */ m) => [m.seq, m.body])).toEqual([
      [3, 'm3'],
      [4, 'm4'],
      [5, 'm5'],
    ]);
    expect(replay.truncated).toBe(false);
    // A conversation the caller is not in is ignored.
    const stranger = await open(stack.gatewayB, stack.fresh());
    expect(
      /** @type {any} */ (
        await stack.ask(stranger, 'sync', { cursors: [{ conversationId, lastSeq: 0 }] })
      ).messages,
    ).toEqual([]);
  });

  it('history pages backwards from the newest; receipts reach the sender as cursors only (members only)', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    const sender = await open(stack.gatewayA, a);
    const receipts = collect(sender, 'receipt.updated');
    for (let i = 1; i <= 5; i += 1) await send(sender, conversationId, `p${i}`);
    // Newest two, then the two before them, then the first one.
    const pages = [];
    let before = /** @type {number | null} */ (6);
    while (before) {
      const page = listMessagesEndpoint.response.schema.parse(
        (
          await stack.rest(
            a,
            `/v1/conversations/${conversationId}/messages?beforeSeq=${before}&limit=2`,
          )
        ).body,
      );
      pages.push(page.items.map((/** @type {any} */ m) => m.seq));
      before = page.prevBeforeSeq;
    }
    expect(pages).toEqual([[4, 5], [2, 3], [1]]);
    // Both share read receipts (off by default; Phase 14, ADR 0024).
    for (const u of [a, b]) {
      const put = await stack.rest(u, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: true });
      expect(put.body).toEqual({ shareReadReceipts: true });
    }
    // The recipient reports delivery then reading: the sender gets the cursors, no content.
    const recipient = await open(stack.gatewayB, b);
    recipient.emit('message.delivered', { conversationId, seq: 5 });
    await eventually(() => receipts.some((r) => r.deliveredSeq === 5), WAIT_MS);
    recipient.emit('message.read', { conversationId, seq: 3 });
    await eventually(() => receipts.some((r) => r.readSeq === 3), WAIT_MS);
    const receipt = new Map(Object.entries(SERVER_EVENTS)).get('receipt.updated')?.payload;
    for (const r of receipts) expect(receipt?.parse(r)).toEqual(r);
    expect(receipts.at(-1)).toEqual({ conversationId, deliveredSeq: 5, readSeq: 3 });
    // A repeated or older cursor sends nothing new.
    const count = receipts.length;
    recipient.emit('message.read', { conversationId, seq: 2 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receipts).toHaveLength(count);
    // The REST view carries the other member's cursors too.
    const latest = (await stack.rest(a, `/v1/conversations/${conversationId}/messages?beforeSeq=6`))
      .body;
    expect(latest).toMatchObject({ peerDeliveredSeq: 5, peerReadSeq: 3, prevBeforeSeq: null });
    // A stranger moving cursors in this conversation changes nothing and tells no one.
    const stranger = await open(stack.gatewayB, stack.fresh());
    stranger.emit('message.read', { conversationId, seq: 5 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receipts).toHaveLength(count);
  });

  for (const [who, label] of /** @type {[string[], string][]} */ ([
    [[], 'neither shares'],
    [['sender'], 'only the sender shares'],
    [['recipient'], 'only the recipient shares'],
  ])) {
    it(`read receipts are never sent or exposed when ${label} (reciprocal, off by default)`, async () => {
      const { a, b, conversationId } = await stack.matchedPair();
      expect((await stack.rest(a, '/v1/me/chat-settings')).body).toEqual({
        shareReadReceipts: false,
      });
      if (who.includes('sender'))
        await stack.rest(a, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: true });
      if (who.includes('recipient'))
        await stack.rest(b, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: true });
      const sender = await open(stack.gatewayA, a);
      const receipts = collect(sender, 'receipt.updated');
      for (let i = 1; i <= 3; i += 1) await send(sender, conversationId, `r${i}`);
      const recipient = await open(stack.gatewayB, b);
      // Reading without a delivery report first: nothing at all reaches the sender.
      recipient.emit('message.read', { conversationId, seq: 2 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(receipts).toEqual([]);
      // Delivery is still reported, with readSeq 0 (the read cursor is not revealed).
      recipient.emit('message.delivered', { conversationId, seq: 3 });
      await eventually(() => receipts.length > 0, WAIT_MS);
      recipient.emit('message.read', { conversationId, seq: 3 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(receipts).toEqual([{ conversationId, deliveredSeq: 3, readSeq: 0 }]);
      // REST shows no read state either, to either side.
      const history = (
        await stack.rest(a, `/v1/conversations/${conversationId}/messages?beforeSeq=9`)
      ).body;
      expect(history).toMatchObject({ peerDeliveredSeq: 3, peerReadSeq: 0 });
      // Turning it off again (after both shared) stops read receipts at once.
      if (who.length === 0) {
        await stack.rest(a, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: true });
        await stack.rest(b, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: true });
        await send(sender, conversationId, 'r4');
        recipient.emit('message.read', { conversationId, seq: 4 });
        await eventually(() => receipts.some((r) => r.readSeq === 4), WAIT_MS);
        await stack.rest(b, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: false });
        const before = receipts.length;
        await send(sender, conversationId, 'r5');
        recipient.emit('message.read', { conversationId, seq: 5 });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(receipts.slice(before).every((r) => r.readSeq === 0)).toBe(true);
        expect(
          (await stack.rest(a, `/v1/conversations/${conversationId}/messages?beforeSeq=9`)).body
            .peerReadSeq,
        ).toBe(0);
      }
    });
  }

  it('chat settings are only the caller’s own and need a session', async () => {
    const { a, b } = await stack.matchedPair();
    await stack.rest(a, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: true });
    expect((await stack.rest(b, '/v1/me/chat-settings')).body).toEqual({
      shareReadReceipts: false,
    });
    const bad = await stack.rest(a, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: 'yes' });
    expect(bad.status).toBe(400);
  });

  it('message.created.v1 (for push) only when the recipient is offline, and never with the body', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    const sender = await open(stack.gatewayA, a);
    await send(sender, conversationId, 'while you were away');
    const online = await open(stack.gatewayB, b);
    await eventually(
      async () => (await stack.app.platform.redis.command.exists(`chat:presence:${b.id}`)) === 1,
      WAIT_MS,
    );
    await send(sender, conversationId, 'now you are here');
    const events = await stack.infra.admin`SELECT payload FROM platform.outbox
      WHERE name = 'message.created.v1' AND payload->>'conversationId' = ${conversationId}`;
    expect(events.map((e) => e.payload.seq)).toEqual([1]);
    expect(JSON.stringify(events)).not.toContain('away');
    online.disconnect();
    await eventually(
      async () => (await stack.app.platform.redis.command.exists(`chat:presence:${b.id}`)) === 0,
      WAIT_MS,
    );
  });

  it('links: none in the first 3 messages, at most 2 after, with a readable reason', async () => {
    const { a, conversationId } = await stack.matchedPair();
    const socket = await open(stack.gatewayA, a);
    expect(await send(socket, conversationId, 'my site is example.com')).toMatchObject({
      ok: false,
      error: {
        code: 'MESSAGE_REJECTED',
        message: 'Links can be shared after your first 3 messages in a conversation.',
      },
    });
    for (const body of ['one', 'two', 'three']) await send(socket, conversationId, body);
    expect(
      /** @type {any} */ (await send(socket, conversationId, 'see https://example.com')).ok,
    ).toBe(true);
    expect(await send(socket, conversationId, 'a.com b.com c.com')).toMatchObject({
      ok: false,
      error: { code: 'MESSAGE_REJECTED', message: 'A message can contain at most 2 links.' },
    });
  });

  it('closing: an unmatch tells both "unmatched"; a block tells the blocked person exactly the same', async () => {
    const unmatched = await stack.matchedPair();
    const [ua, ub] = [
      await open(stack.gatewayA, unmatched.a),
      await open(stack.gatewayB, unmatched.b),
    ];
    const [closedUa, closedUb] = [
      collect(ua, 'conversation.closed'),
      collect(ub, 'conversation.closed'),
    ];
    await stack.rest(unmatched.a, `/v1/matches/${unmatched.conversationId}/unmatch`, 'POST', {});
    await eventually(() => closedUa.length === 1 && closedUb.length === 1, WAIT_MS);
    const ordinary = closedUb[0];
    expect(ordinary).toEqual({ conversationId: unmatched.conversationId, reason: 'unmatched' });
    expect(closedUa[0]).toEqual(ordinary);
    // Sending afterwards is refused.
    expect(await send(ua, unmatched.conversationId, 'still there?')).toMatchObject({
      ok: false,
      error: { code: 'CONVERSATION_CLOSED' },
    });

    const blocked = await stack.matchedPair();
    const [ba, bb] = [await open(stack.gatewayA, blocked.a), await open(stack.gatewayB, blocked.b)];
    const [closedBa, closedBb] = [
      collect(ba, 'conversation.closed'),
      collect(bb, 'conversation.closed'),
    ];
    await stack.rest(blocked.a, '/v1/blocks', 'POST', { targetId: blocked.b.public_id });
    await eventually(() => closedBa.length === 1 && closedBb.length === 1, WAIT_MS);
    expect(closedBa[0]).toEqual({ conversationId: blocked.conversationId, reason: 'blocked' });
    // The blocked person's notice has the same shape and reason as an ordinary unmatch.
    expect(Object.keys(closedBb[0]).sort()).toEqual(Object.keys(ordinary).sort());
    expect(closedBb[0].reason).toBe(ordinary.reason);
    expect(await send(bb, blocked.conversationId, 'hello?')).toMatchObject({
      ok: false,
      error: { code: 'CONVERSATION_CLOSED' },
    });
    // Nothing more arrives later (the matching unmatch event finds it closed already).
    await new Promise((r) => setTimeout(r, 1500));
    expect(closedBb).toHaveLength(1);
  });

  it('a ban: the other person is told exactly what an unmatch says', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    const socketA = await open(stack.gatewayA, a);
    const closed = collect(socketA, 'conversation.closed');
    await stack.infra.admin`INSERT INTO safety.bans (id, user_id, reason, created_by)
      VALUES (${randomUUID()}, ${b.id}, 'test', ${randomUUID()})`;
    // What a ban will do in Phase 10: matching ends the match without a user action.
    await stack.infra
      .admin`UPDATE matching.matches SET unmatched_at = now() WHERE id = ${conversationId}`;
    const consumer = stack.app.boot.consumers.find(
      (/** @type {any} */ c) => c.module === 'chat' && c.event === 'match.unmatched.v1',
    );
    const { createConsumer } = await import('../../../src/platform/events/consume.js');
    const { EVENTS } = await import('@vouch/contracts');
    await createConsumer({
      db: stack.app.platform.db,
      consumer: 'chat',
      event: EVENTS['match.unmatched.v1'],
      handler: consumer.handler,
    })({
      data: {
        id: 9_000_001,
        name: 'match.unmatched.v1',
        version: 1,
        occurredAt: new Date().toISOString(),
        traceId: null,
        payload: {
          matchId: conversationId,
          userLow: a.id < b.id ? a.id : b.id,
          userHigh: a.id < b.id ? b.id : a.id,
          unmatchedBy: null,
          unmatchedAt: new Date().toISOString(),
        },
      },
    });
    await eventually(() => closed.length === 1, WAIT_MS);
    expect(closed[0]).toEqual({ conversationId, reason: 'unmatched' });
  });

  it('account deletion tells the other person "deleted" and erases the sender’s messages', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    const socketA = await open(stack.gatewayA, a);
    const socketB = await open(stack.gatewayB, b);
    const closed = collect(socketB, 'conversation.closed');
    await send(socketA, conversationId, 'bye');
    await stack.rest(a, '/v1/me/chat-settings', 'PUT', { shareReadReceipts: true });
    const { status } = await stack.rest(a, '/v1/me', 'DELETE');
    expect(status).toBe(202);
    await eventually(() => closed.length === 1, WAIT_MS);
    expect(closed[0]).toEqual({ conversationId, reason: 'deleted' });
    await eventually(
      async () =>
        (await stack.infra.admin`SELECT 1 FROM chat.messages WHERE sender_id = ${a.id}`).length ===
        0,
      WAIT_MS,
    );
    // The chat settings row goes too.
    await eventually(
      async () =>
        (await stack.infra.admin`SELECT 1 FROM chat.member_settings WHERE user_id = ${a.id}`)
          .length === 0,
      WAIT_MS,
    );
    expect(socketA.connected).toBe(true); // disconnected by the client app, not the server
  });

  it('the per-user message rate limit applies (fails open when Redis is down)', async () => {
    const { a, conversationId } = await stack.matchedPair();
    const socket = await open(stack.gatewayA, a);
    const acks = [];
    for (let i = 0; i < 41; i += 1) acks.push(await send(socket, conversationId, `n${i}`));
    expect(acks.slice(0, 40).every((x) => /** @type {any} */ (x).ok)).toBe(true);
    expect(acks.at(-1)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('export contains only the user’s own sent messages; retention purges closed conversations after 30 days', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    const [sa, sb] = [await open(stack.gatewayA, a), await open(stack.gatewayB, b)];
    await send(sa, conversationId, 'mine');
    await send(sb, conversationId, 'theirs');
    const exported = (await stack.rest(a, '/v1/me/export')).body;
    expect(exported.data.chat.sentMessages.map((/** @type {any} */ m) => m.body)).toEqual(['mine']);
    expect(exported.data.chat.shareReadReceipts).toBe(false);
    await stack.infra
      .admin`UPDATE chat.conversations SET closed_at = now() - interval '31 days' WHERE id = ${conversationId}`;
    const job = stack.app.boot.jobs.find((/** @type {any} */ j) => j.name === 'chat.retentionTick');
    const { deleted } = await job.handler({ data: {} });
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(
      await stack.infra
        .admin`SELECT 1 FROM chat.messages WHERE conversation_id = ${conversationId}`,
    ).toHaveLength(0);
  });

  it('drain: new connections are refused and existing sockets leave', async () => {
    const user = stack.fresh();
    const socket = await open(stack.gatewayB, user);
    const gone = new Promise((resolve) => socket.once('disconnect', resolve));
    const started = Date.now();
    await stack.gatewayB.gateway.drain(2000);
    await gone;
    expect(Date.now() - started).toBeLessThan(3000);
    await expect(stack.socketFor(stack.gatewayB, user)).rejects.toBeDefined();
  });
});
