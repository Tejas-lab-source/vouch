// @ts-check
import { messageCreated, ServiceError } from '@vouch/contracts';
import { MESSAGE_FILTERS } from './filters.js';
import { messageView, otherMember } from './views.js';

const MINUTE_MS = 60_000;

/**
 * `message.send` (ADR 0017). Checks, then one transaction under the conversation row lock: a
 * repeated `clientMsgId` returns the original message without using a seq; otherwise the next
 * gapless seq is taken and the message inserted. The ack and the live `message.new` happen only
 * after commit; a recipient who misses the live event gets the message through `sync`.
 * @param {import('../ports.js').ChatDeps & {
 *   memberConversation: (id: string, userId: string) => Promise<import('../ports.js').ConversationRecord>,
 *   publicIdsOf: (ids: readonly string[]) => Promise<Map<string, string>>,
 * }} deps
 */
export function makeSend(deps) {
  const { uow, presence, sockets, rateLimiter, pipelines, safety, settings, clock } = deps;
  const { memberConversation, publicIdsOf } = deps;

  /**
   * @param {{ conversationId: string, clientMsgId: string, kind: 'text', body: string }} input
   * @param {{ actor: { userId: string } | null }} ctx
   */
  async function send(input, ctx) {
    const me = /** @type {string} */ (ctx.actor?.userId);
    await rateLimiter.hit([
      { key: `chat:messages:${me}`, max: settings.messagesPerMinute, windowMs: MINUTE_MS },
    ]);
    const conversation = await memberConversation(input.conversationId, me);
    const recipient = otherMember(conversation, me);
    if (conversation.closedAt) throw new ServiceError('CONVERSATION_CLOSED');
    if (await safety.blockPolicy.isBlocked(me, recipient)) {
      throw new ServiceError('CONVERSATION_CLOSED');
    }

    const verdicts = await pipelines.collect(MESSAGE_FILTERS, {
      conversationId: conversation.id,
      senderId: me,
      recipientId: recipient,
      kind: input.kind,
      body: input.body,
    });
    if (verdicts.length === 0) throw new Error(`${MESSAGE_FILTERS} returned no verdict`);
    const refusal = verdicts.map((v) => v.value).find((v) => v.allow === false);
    if (refusal) {
      throw new ServiceError(refusal.code, refusal.reason ? { message: refusal.reason } : {});
    }

    const recipientOnline = await presence.isOnline(recipient);
    const { message, created } = await uow.run(async ({ stores, emit }) => {
      const locked = await stores.conversations.findForUpdate(conversation.id);
      if (!locked || locked.closedAt) throw new ServiceError('CONVERSATION_CLOSED');
      const duplicate = await stores.messages.byClientId(conversation.id, input.clientMsgId);
      if (duplicate) return { message: duplicate, created: false };
      const seq = await stores.conversations.nextSeq(conversation.id);
      /** @type {import('../ports.js').MessageRecord} */
      const record = {
        conversationId: conversation.id,
        seq,
        senderId: me,
        clientMsgId: input.clientMsgId,
        kind: input.kind,
        body: input.body,
        createdAt: clock.now(),
      };
      await stores.messages.insert(record);
      if (!recipientOnline) {
        await emit(messageCreated, {
          conversationId: conversation.id,
          seq,
          senderId: me,
          recipientId: recipient,
          kind: input.kind,
          createdAt: record.createdAt.toISOString(),
        });
      }
      return { message: record, created: true };
    });

    if (created) {
      const ids = await publicIdsOf([me, recipient]);
      const payload = messageView(message, ids);
      // Both members' rooms: the recipient, and the sender's other devices.
      sockets.emitToUser(recipient, 'message.new', payload);
      sockets.emitToUser(me, 'message.new', payload);
    }
    return {
      clientMsgId: message.clientMsgId,
      seq: message.seq,
      createdAt: message.createdAt.toISOString(),
    };
  }

  return { send };
}
