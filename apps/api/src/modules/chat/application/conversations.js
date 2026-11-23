// @ts-check
import { ServiceError } from '@vouch/contracts';
import { closeNotices } from '../domain/closing.js';
import { createPublicIds, isMember, messageView, otherMember } from './views.js';

/**
 * Conversations: opening (one per match, id = match id), closing with per-member notices,
 * the inbox and message history.
 * @param {import('../ports.js').ChatDeps} deps
 */
export function makeConversations(deps) {
  const { useCase, uow, read, identity, profiles, safety, matching, sockets, clock } = deps;
  const publicIdsOf = createPublicIds(identity);

  /**
   * Opens the conversation for an active match (idempotent). Returns the conversation, or null
   * when the match does not exist or has ended.
   * @param {string} matchId
   */
  async function openConversation(matchId) {
    const existing = await read((stores) => stores.conversations.find(matchId));
    if (existing) return existing;
    const match = await matching.getMatch(matchId);
    if (!match || match.unmatchedAt || match.anonymisedAt) return null;
    await uow.run(async ({ stores }) => {
      await stores.conversations.insertIfMissing({
        id: match.id,
        userLow: match.userLow,
        userHigh: match.userHigh,
        at: clock.now(),
      });
      await stores.cursors.ensure(match.id, [match.userLow, match.userHigh]);
    });
    return read((stores) => stores.conversations.find(matchId));
  }

  /**
   * Closes a conversation (idempotent) and tells each member, after commit, with the reason
   * they are allowed to see (`domain/closing.js`). Only the call that closes it notifies.
   * @param {import('../ports.js').ChatStores} stores  The caller's transaction (consumer).
   * @param {string} conversationId
   * @param {(fn: () => unknown) => void} afterCommit
   */
  async function closeConversation(stores, conversationId, afterCommit) {
    const conversation = await stores.conversations.findForUpdate(conversationId);
    if (!conversation || conversation.closedAt) return false;
    await stores.conversations.close(conversationId, clock.now());
    const { userLow, userHigh } = conversation;
    const [blockers, users, banned] = await Promise.all([
      safety.blockersBetween(userLow, userHigh),
      identity.getUsersByIds([userLow, userHigh]),
      safety.bannedAmong([userLow, userHigh]),
    ]);
    const deleted = [userLow, userHigh].filter(
      (id) => !users.some((u) => u.id === id && u.status !== 'deleted'),
    );
    const notices = closeNotices(conversation, { blockers, deleted, banned: [...banned] });
    afterCommit(() => {
      for (const [userId, reason] of notices) {
        sockets.emitToUser(userId, 'conversation.closed', { conversationId, reason });
      }
    });
    return true;
  }

  /**
   * A conversation the caller may read: NOT_FOUND when it does not exist, NOT_A_MEMBER when the
   * caller is not in it.
   * @param {string} conversationId
   * @param {string} userId
   */
  async function memberConversation(conversationId, userId) {
    const conversation =
      (await read((stores) => stores.conversations.find(conversationId))) ??
      (await openConversation(conversationId).catch(() => null));
    if (!conversation) throw new ServiceError('NOT_FOUND');
    if (!isMember(conversation, userId)) throw new ServiceError('NOT_A_MEMBER');
    return conversation;
  }

  const listMessages = useCase(
    'chat.listMessages',
    /** @param {{ id: string, afterSeq: number, beforeSeq?: number, limit: number }} input */
    async (input, ctx) => {
      const me = /** @type {string} */ (ctx.actor?.userId);
      const conversation = await memberConversation(input.id, me);
      const peer = otherMember(conversation, me);
      const backwards = input.beforeSeq !== undefined;
      const { rows, cursors } = await read(async (stores) => ({
        rows: backwards
          ? await stores.messages.before(
              conversation.id,
              /** @type {number} */ (input.beforeSeq),
              input.limit + 1,
            )
          : await stores.messages.after(conversation.id, input.afterSeq, input.limit + 1),
        cursors: await stores.cursors.get(conversation.id, peer),
      }));
      // Backwards pages hold the newest `limit` rows before `beforeSeq` (the extra row is the
      // oldest one, which only says that more exist).
      const pageRows = backwards ? rows.slice(-input.limit) : rows.slice(0, input.limit);
      const ids = await publicIdsOf([conversation.userLow, conversation.userHigh]);
      return {
        items: pageRows.map((m) => messageView(m, ids)),
        nextAfterSeq:
          !backwards && rows.length > input.limit ? (pageRows.at(-1)?.seq ?? null) : null,
        prevBeforeSeq:
          backwards && rows.length > input.limit ? (pageRows.at(0)?.seq ?? null) : null,
        peerDeliveredSeq: cursors.deliveredSeq,
        peerReadSeq: cursors.readSeq,
      };
    },
  );

  const listConversations = useCase(
    'chat.listConversations',
    /** @param {{ cursor?: string, limit: number }} input */
    async (input, ctx) => {
      const me = /** @type {string} */ (ctx.actor?.userId);
      const after = decodeCursor(input.cursor);
      const rows = await read((stores) => stores.conversations.forUser(me, after, input.limit + 1));
      const pageRows = rows.slice(0, input.limit);
      const others = pageRows.map((c) => otherMember(c, me));
      const [cards, ids, details] = await Promise.all([
        profiles.getCards(others),
        publicIdsOf([me, ...others]),
        read(async (stores) =>
          Promise.all(
            pageRows.map(async (c) => ({
              last: c.lastSeq > 0 ? await stores.messages.last(c.id, c.lastSeq) : null,
              lastReadSeq: await stores.cursors.lastRead(c.id, me),
            })),
          ),
        ),
      ]);
      const cardByPublicId = new Map(cards.map((card) => [card.userId, card]));
      const items = pageRows.flatMap((c, i) => {
        const card = cardByPublicId.get(ids.get(otherMember(c, me)) ?? '');
        const detail = details.at(i);
        if (!card || !detail) return [];
        return [
          {
            conversationId: c.id,
            matchId: c.matchId,
            user: card,
            lastMessage: detail.last ? messageView(detail.last, ids) : null,
            lastReadSeq: detail.lastReadSeq,
            closed: c.closedAt !== null,
            updatedAt: c.activityAt.toISOString(),
          },
        ];
      });
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor:
          rows.length > input.limit && last
            ? Buffer.from(`${last.activityAt.toISOString()}|${last.id}`).toString('base64url')
            : null,
      };
    },
  );

  return {
    openConversation,
    closeConversation,
    memberConversation,
    listMessages,
    listConversations,
    publicIdsOf,
  };
}

/** @param {string | undefined} cursor */
function decodeCursor(cursor) {
  if (!cursor) return null;
  const [at = '', id = ''] = Buffer.from(cursor, 'base64url').toString().split('|');
  const activityAt = new Date(at);
  if (Number.isNaN(activityAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { activityAt, id };
}
