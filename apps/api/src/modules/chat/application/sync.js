// @ts-check
import { isMember, messageView } from './views.js';

/** At most this many messages per `sync` ack (contract); `truncated` asks for another call. */
export const SYNC_MAX = 500;

/**
 * Replay and cursors over the socket.
 * @param {import('../ports.js').ChatDeps & { publicIdsOf: (ids: readonly string[]) => Promise<Map<string, string>> }} deps
 */
export function makeSync({ read, uow, publicIdsOf }) {
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
      await uow.run(async ({ stores }) => {
        const conversation = await stores.conversations.find(conversationId);
        if (!conversation || !isMember(conversation, me)) return;
        // Never past the last message, never backwards.
        const upTo = Math.min(seq, conversation.lastSeq);
        if (which === 'read') await stores.cursors.advanceRead(conversationId, me, upTo);
        else await stores.cursors.advanceDelivered(conversationId, me, upTo);
      });
      return {};
    };

  return { sync, markRead: advance('read'), markDelivered: advance('delivered') };
}
