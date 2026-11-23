// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { startChatStack } from '../modules/chat/harness.js';

describe('invariant: retrying message.send with the same clientMsgId stores one message', () => {
  /** @type {Awaited<ReturnType<typeof startChatStack>>} */
  let stack;
  beforeAll(async () => {
    stack = await startChatStack();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => stack?.stop(), HOOK_TIMEOUT_MS);

  it('5 concurrent retries and 5 sequential retries (across both gateways): one row, one seq', async () => {
    const { a, conversationId } = await stack.matchedPair();
    const onA = await stack.socketFor(stack.gatewayA, a);
    const onB = await stack.socketFor(stack.gatewayB, a);
    const clientMsgId = randomUUID();
    const payload = { conversationId, clientMsgId, kind: 'text', body: 'only once' };
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, (_, i) => stack.ask(i % 2 ? onB : onA, 'message.send', payload)),
    );
    const sequential = [];
    for (let i = 0; i < 5; i += 1) sequential.push(await stack.ask(onA, 'message.send', payload));
    const acks = [...concurrent, ...sequential].map((/** @type {any} */ x) => x);
    expect(acks.every((x) => x.ok && x.seq === 1 && x.clientMsgId === clientMsgId)).toBe(true);
    expect(new Set(acks.map((x) => x.createdAt)).size).toBe(1);
    const rows = await stack.infra
      .admin`SELECT seq FROM chat.messages WHERE conversation_id = ${conversationId}`;
    expect(rows).toEqual([{ seq: '1' }]);
    const [conversation] = await stack.infra
      .admin`SELECT last_seq FROM chat.conversations WHERE id = ${conversationId}`;
    expect(Number(conversation.last_seq)).toBe(1);
    // The next new message takes seq 2: retries consumed no seq.
    expect(
      await stack.ask(onA, 'message.send', { ...payload, clientMsgId: randomUUID(), body: 'next' }),
    ).toMatchObject({
      ok: true,
      seq: 2,
    });
    process.stdout.write(
      `PHASE9_IDEMPOTENT ${JSON.stringify({ attempts: acks.length, rows: rows.length, lastSeqAfterRetries: 1 })}\n`,
    );
    onA.disconnect();
    onB.disconnect();
  });
});
