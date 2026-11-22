// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { startChatStack } from '../modules/chat/harness.js';

describe('invariant: messages to a closed or blocked conversation are refused and never stored', () => {
  /** @type {Awaited<ReturnType<typeof startChatStack>>} */
  let stack;
  beforeAll(async () => {
    stack = await startChatStack();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => stack?.stop(), HOOK_TIMEOUT_MS);

  /** @param {any} socket @param {string} conversationId */
  const send = (socket, conversationId) =>
    stack.ask(socket, 'message.send', {
      conversationId,
      clientMsgId: randomUUID(),
      kind: 'text',
      body: 'should not be stored',
    });
  /** @param {string} conversationId */
  const stored = async (conversationId) =>
    (await stack.infra.admin`SELECT 1 FROM chat.messages WHERE conversation_id = ${conversationId}`)
      .length;

  it('closed (unmatched): refused from both sides', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    await stack.rest(a, `/v1/matches/${conversationId}/unmatch`, 'POST', {});
    await eventually(
      async () =>
        (
          await stack.infra
            .admin`SELECT closed_at FROM chat.conversations WHERE id = ${conversationId}`
        )[0]?.closed_at,
      20_000,
    );
    for (const user of [a, b]) {
      const socket = await stack.socketFor(stack.gatewayA, user);
      expect(await send(socket, conversationId)).toMatchObject({
        ok: false,
        error: { code: 'CONVERSATION_CLOSED' },
      });
      socket.disconnect();
    }
    expect(await stored(conversationId)).toBe(0);
  });

  it('blocked, even before the conversation is closed by the consumers: refused, as a closed conversation', async () => {
    const { a, b, conversationId } = await stack.matchedPair();
    // Stop the consumers from closing it first: block directly, as the block use case does.
    const policy = stack.app.boot.apis.get('safety').blockPolicy;
    await stack.infra
      .admin`INSERT INTO safety.blocks (blocker_id, blocked_id) VALUES (${b.id}, ${a.id})`;
    await stack.app.platform.redis.command.del(`safety:blocked:${a.id}`, `safety:blocked:${b.id}`);
    expect(await policy.isBlocked(a.id, b.id)).toBe(true);
    const [conversation] = await stack.infra
      .admin`SELECT closed_at FROM chat.conversations WHERE id = ${conversationId}`;
    expect(conversation.closed_at).toBeNull();
    for (const user of [a, b]) {
      const socket = await stack.socketFor(stack.gatewayB, user);
      expect(await send(socket, conversationId)).toMatchObject({
        ok: false,
        error: { code: 'CONVERSATION_CLOSED' },
      });
      socket.disconnect();
    }
    expect(await stored(conversationId)).toBe(0);
  });

  it('not a member: refused, nothing stored', async () => {
    const { conversationId } = await stack.matchedPair();
    const socket = await stack.socketFor(stack.gatewayA, stack.fresh());
    expect(await send(socket, conversationId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
    socket.disconnect();
    expect(await stored(conversationId)).toBe(0);
  });
});
