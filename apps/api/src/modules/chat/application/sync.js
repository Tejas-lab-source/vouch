// @ts-check
import { isMember, messageView, otherMember } from './views.js';

/** At most this many messages per `sync` ack (contract); `truncated` asks for another call. */
export const SYNC_MAX = 500;

/**
 * Replay and cursors over the socket.
 * @param {import('../ports.js').ChatDeps & { publicIdsOf: (ids: readonly string[]) => Promise<Map<string, string>> }} deps
 */
export function makeSync({ read, uow, publicIdsOf, sockets, useCase, clock }) {
  /**
   * Every message after each cursor, in seq order per conversation, for conversations the
   * caller belongs to (others are ignored). Capped at 500 with `truncated`.
   * @param {{ cursors: { conversationId: string, lastSeq: number }[] }} input
   * @param {{ actor: { userId: string } | null }} ctx
   */
  async function sync({ cursors }, ctx) {
    const me = /** @type {string} */ (ctx.actor?.userId);
    /** @type {import('../ports.js').MessageRecord[]} */
    const messages = [];
    let truncated = false;
    /** @type {Set<string>} */
    const members = new Set();
    await read(async (stores) => {
      for (const cursor of cursors) {
        const room = SYNC_MAX - messages.length;
        if (room <= 0) {
          truncated = true;
          break;
        }
        const conversation = await stores.conversations.find(cursor.conversationId);
        if (!conversation || !isMember(conversation, me)) continue;
        members.add(conversation.userLow).add(conversation.userHigh);
        const rows = await stores.messages.after(conversation.id, cursor.lastSeq, room + 1);
        if (rows.length > room) truncated = true;
        messages.push(...rows.slice(0, room));
      }
    });
    const ids = await publicIdsOf([...members]);
    return { messages: messages.map((m) => messageView(m, ids)), truncated };
  }

  /**
   * @param {'read' | 'delivered'} which
   * @returns {(input: { conversationId: string, seq: number }, ctx: { actor: { userId: string } | null }) => Promise<{}>}
   */
  const advance =
    (which) =>
    async ({ conversationId, seq }, ctx) => {
      const me = /** @type {string} */ (ctx.actor?.userId);
      const moved = await uow.run(async ({ stores }) => {
        const conversation = await stores.conversations.find(conversationId);
        if (!conversation || !isMember(conversation, me)) return null;
        // Never past the last message, never backwards.
        const upTo = Math.min(seq, conversation.lastSeq);
        const before = await stores.cursors.get(conversationId, me);
        if (which === 'read') await stores.cursors.advanceRead(conversationId, me, upTo);
        else await stores.cursors.advanceDelivered(conversationId, me, upTo);
        const after = await stores.cursors.get(conversationId, me);
        const peer = otherMember(conversation, me);
        // Read receipts are reciprocal and off by default (Phase 14, ADR 0024): read state is
        // visible only when both members share it. Otherwise only delivery is reported, and a
        // read move reports nothing at all (not even an implied delivery).
        const sharing = await stores.settings.sharing([me, peer]);
        const shared = sharing.has(me) && sharing.has(peer);
        const view = (/** @type {{ readSeq: number, deliveredSeq: number }} */ c) =>
          shared
            ? { deliveredSeq: Math.max(c.deliveredSeq, c.readSeq), readSeq: c.readSeq }
            : { deliveredSeq: c.deliveredSeq, readSeq: 0 };
        const [was, now] = [view(before), view(after)];
        const changed = was.readSeq !== now.readSeq || was.deliveredSeq !== now.deliveredSeq;
        return changed ? { peer, cursors: now } : null;
      });
      // After commit: tell the other member (cursors only, never content).
      if (moved && sockets) {
        sockets.emitToUser(moved.peer, 'receipt.updated', { conversationId, ...moved.cursors });
      }
      return {};
    };

  /** `GET /v1/me/chat-settings`. */
  const getChatSettings = useCase('chat.getSettings', async (/** @type {unknown} */ _i, ctx) => {
    const me = /** @type {string} */ (ctx.actor?.userId);
    return { shareReadReceipts: (await read((stores) => stores.settings.sharing([me]))).has(me) };
  });

  /** `PUT /v1/me/chat-settings`. */
  const putChatSettings = useCase(
    'chat.putSettings',
    /** @param {{ shareReadReceipts: boolean }} input */
    async (input, ctx) => {
      const me = /** @type {string} */ (ctx.actor?.userId);
      await uow.run(({ stores }) => stores.settings.put(me, input.shareReadReceipts, clock.now()));
      return { shareReadReceipts: input.shareReadReceipts };
    },
  );

  return {
    sync,
    markRead: advance('read'),
    markDelivered: advance('delivered'),
    getChatSettings,
    putChatSettings,
  };
}
