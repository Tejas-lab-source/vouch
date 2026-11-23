// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { startChatStack } from '../modules/chat/harness.js';

const MESSAGES = 200;
const KILL_AFTER = 60;

describe('invariant: a gateway dies mid-stream; every acked message arrives exactly once, in seq order', () => {
  /** @type {Awaited<ReturnType<typeof startChatStack>>} */
  let stack;
  // One sender sends 200 messages quickly; the per-user limit is not what is tested here.
  const env = { RATE_LIMIT_MESSAGES_MINUTE: '100000' };

  beforeAll(async () => {
    stack = await startChatStack(env);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await stack?.stop();
  }, HOOK_TIMEOUT_MS);

  it(`${MESSAGES} messages; gateway A is killed after ${KILL_AFTER} acks; both clients move to B`, async () => {
    const [a, b] = await Promise.all([stack.spawnGateway(), stack.spawnGateway()]);
    const socketAt = stack.socketAt;
    const { a: senderUser, b: recipientUser, conversationId } = await stack.matchedPair();
    const senderToken = await stack.token(senderUser);
    const recipientToken = await stack.token(recipientUser);

    /** @type {Map<number, any>} Messages the recipient saw, by seq (live or replayed). */
    const received = new Map();
    /** @type {Map<string, number[]>} clientMsgId → every seq the recipient saw it under. */
    const seqsByClientId = new Map();
    const record = (/** @type {any} */ m) => {
      received.set(m.seq, m);
      seqsByClientId.set(m.clientMsgId, [
        ...new Set([...(seqsByClientId.get(m.clientMsgId) ?? []), m.seq]),
      ]);
    };
    /** @param {any} socket */
    const listen = (socket) => socket.on('message.new', record);

    let sender = /** @type {any} */ (await socketAt(a.url, senderToken));
    let recipient = /** @type {any} */ (await socketAt(a.url, recipientToken));
    listen(recipient);

    const clientIds = Array.from({ length: MESSAGES }, () => randomUUID());
    /** @type {Map<string, number>} clientMsgId → acked seq */
    const acked = new Map();
    let killed = false;

    /** Sends one message; resolves with its ack, or null if the socket died first. */
    const sendOnce = (
      /** @type {any} */ socket,
      /** @type {string} */ id,
      /** @type {number} */ i,
    ) =>
      new Promise((resolve) => {
        const onDisconnect = () => resolve(null);
        socket.once('disconnect', onDisconnect);
        socket
          .timeout(5000)
          .emit(
            'message.send',
            { conversationId, clientMsgId: id, kind: 'text', body: `msg ${i}` },
            (/** @type {unknown} */ err, /** @type {any} */ ack) => {
              socket.off('disconnect', onDisconnect);
              resolve(err ? null : ack);
            },
          );
      });

    for (let i = 0; i < MESSAGES; i += 1) {
      const id = /** @type {string} */ (clientIds.at(i));
      for (;;) {
        if (!killed && acked.size === KILL_AFTER) {
          killed = true;
          a.child.kill('SIGKILL');
          await eventually(() => !sender.connected && !recipient.connected, 10_000);
          // Both clients reconnect to the surviving gateway; the recipient syncs.
          sender = await socketAt(b.url, senderToken);
          recipient = await socketAt(b.url, recipientToken);
          listen(recipient);
          const lastSeq = Math.max(0, ...received.keys());
          const replay = await new Promise((resolve) =>
            recipient.emit('sync', { cursors: [{ conversationId, lastSeq }] }, resolve),
          );
          for (const m of /** @type {any} */ (replay).messages) record(m);
        }
        const ack = /** @type {any} */ (await sendOnce(sender, id, i));
        if (ack?.ok) {
          acked.set(id, ack.seq);
          break;
        }
        // No ack (the gateway died mid-send): retry with the same clientMsgId.
        await eventually(() => killed && sender.connected, 15_000);
      }
    }

    // Final catch-up, as a client would do after the stream.
    await eventually(() => received.size >= MESSAGES, 10_000).catch(async () => {
      const lastSeq = Math.max(0, ...received.keys());
      const replay = await new Promise((resolve) =>
        recipient.emit('sync', { cursors: [{ conversationId, lastSeq }] }, resolve),
      );
      for (const m of /** @type {any} */ (replay).messages) record(m);
    });

    const rows = (
      await stack.infra.admin`SELECT seq, client_msg_id FROM chat.messages
        WHERE conversation_id = ${conversationId} ORDER BY seq`
    ).map((r) => ({ seq: Number(r.seq), client_msg_id: r.client_msg_id }));
    const seqs = [...received.keys()].sort((x, y) => x - y);
    const report = {
      messages: MESSAGES,
      acked: acked.size,
      storedRows: rows.length,
      receivedBySeq: received.size,
      gapless: seqs.every((s, i) => s === i + 1),
      clientIdsWithMoreThanOneSeq: [...seqsByClientId.values()].filter((v) => v.length > 1).length,
    };
    process.stdout.write(`PHASE9_FAILOVER ${JSON.stringify(report)}\n`);

    expect(killed).toBe(true);
    expect(acked.size).toBe(MESSAGES);
    // Stored exactly once each, gapless, in send order.
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: MESSAGES }, (_, i) => i + 1));
    expect(rows.map((r) => r.client_msg_id)).toEqual(clientIds);
    // The recipient has every acked message exactly once, in seq order.
    expect(seqs).toEqual(rows.map((r) => r.seq));
    expect(seqs.map((s) => received.get(s).clientMsgId)).toEqual(clientIds);
    expect(report.clientIdsWithMoreThanOneSeq).toBe(0);
    for (const [id, seq] of acked) expect(received.get(seq)?.clientMsgId).toBe(id);
    sender.disconnect();
    recipient.disconnect();
  }, 300_000);
});
