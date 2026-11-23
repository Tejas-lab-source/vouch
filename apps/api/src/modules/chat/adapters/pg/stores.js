// @ts-check

/**
 * Postgres stores of chat (role `vouch_chat`), bound to one transaction.
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').ChatStores}
 */
export function createChatStores(tx) {
  const CONVERSATION = tx`id, match_id, user_low, user_high, last_seq::int AS last_seq, created_at, closed_at`;
  const MESSAGE = tx`conversation_id, seq::int AS seq, sender_id, client_msg_id, kind, body, created_at`;
  /** @param {any[]} rows */
  const first = (rows) => rows[0] ?? null;

  return {
    conversations: {
      insertIfMissing: async ({ id, userLow, userHigh, at }) =>
        (
          await tx`INSERT INTO chat.conversations (id, match_id, user_low, user_high, created_at)
            VALUES (${id}, ${id}, ${userLow}, ${userHigh}, ${at}) ON CONFLICT DO NOTHING`
        ).count === 1,
      find: async (id) =>
        first(await tx`SELECT ${CONVERSATION} FROM chat.conversations WHERE id = ${id}`),
      findForUpdate: async (id) =>
        first(await tx`SELECT ${CONVERSATION} FROM chat.conversations WHERE id = ${id} FOR UPDATE`),
      nextSeq: async (id) =>
        Number(
          (
            await tx`UPDATE chat.conversations SET last_seq = last_seq + 1
              WHERE id = ${id} RETURNING last_seq::int AS last_seq`
          )[0]?.lastSeq,
        ),
      close: async (id, at) =>
        (
          await tx`UPDATE chat.conversations SET closed_at = ${at}
            WHERE id = ${id} AND closed_at IS NULL`
        ).count === 1,
      forUser: async (userId, after, limit) =>
        /** @type {any} */ (
          await tx`SELECT * FROM (
              SELECT c.id, c.match_id, c.user_low, c.user_high, c.last_seq::int AS last_seq,
                c.created_at, c.closed_at, coalesce(m.created_at, c.created_at) AS activity_at
              FROM chat.conversations c
              LEFT JOIN chat.messages m ON m.conversation_id = c.id AND m.seq = c.last_seq
              WHERE c.user_low = ${userId} OR c.user_high = ${userId}
            ) x
            ${after ? tx`WHERE (x.activity_at, x.id) < (${after.activityAt}, ${after.id})` : tx``}
            ORDER BY x.activity_at DESC, x.id DESC
            LIMIT ${limit}`
        ),
      openForUser: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT ${CONVERSATION} FROM chat.conversations
            WHERE (user_low = ${userId} OR user_high = ${userId}) AND closed_at IS NULL`
        ),
    },
    messages: {
      insert: async (m) => {
        await tx`INSERT INTO chat.messages (conversation_id, seq, sender_id, client_msg_id, kind, body, created_at)
          VALUES (${m.conversationId}, ${m.seq}, ${m.senderId}, ${m.clientMsgId}, ${m.kind}, ${m.body}, ${m.createdAt})`;
      },
      byClientId: async (conversationId, clientMsgId) =>
        first(
          await tx`SELECT ${MESSAGE} FROM chat.messages
            WHERE conversation_id = ${conversationId} AND client_msg_id = ${clientMsgId}`,
        ),
      last: async (conversationId, seq) =>
        first(
          await tx`SELECT ${MESSAGE} FROM chat.messages
            WHERE conversation_id = ${conversationId} AND seq = ${seq}`,
        ),
      after: async (conversationId, afterSeq, limit) =>
        /** @type {any} */ (
          await tx`SELECT ${MESSAGE} FROM chat.messages
            WHERE conversation_id = ${conversationId} AND seq > ${afterSeq}
            ORDER BY seq LIMIT ${limit}`
        ),
      before: async (conversationId, beforeSeq, limit) =>
        /** @type {any} */ (
          await tx`SELECT ${MESSAGE} FROM chat.messages
            WHERE conversation_id = ${conversationId} AND seq < ${beforeSeq}
            ORDER BY seq DESC LIMIT ${limit}`
        ).reverse(),
      countBySender: async (conversationId, senderId, upTo) =>
        Number(
          (
            await tx`SELECT count(*)::int AS n FROM (
                SELECT 1 FROM chat.messages
                WHERE conversation_id = ${conversationId} AND sender_id = ${senderId}
                LIMIT ${upTo}) s`
          )[0]?.n ?? 0,
        ),
      sentBy: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT ${MESSAGE} FROM chat.messages WHERE sender_id = ${userId}
            ORDER BY created_at`
        ),
      removeBySender: async (userId) =>
        (await tx`DELETE FROM chat.messages WHERE sender_id = ${userId}`).count,
      purgeClosed: async (olderThan, limit) =>
        (
          await tx`DELETE FROM chat.messages WHERE (conversation_id, seq) IN (
              SELECT m.conversation_id, m.seq FROM chat.messages m
              JOIN chat.conversations c ON c.id = m.conversation_id
              WHERE c.closed_at < ${olderThan} LIMIT ${limit})`
        ).count,
    },
    cursors: {
      ensure: async (conversationId, userIds) => {
        for (const userId of userIds) {
          await tx`INSERT INTO chat.read_cursors (conversation_id, user_id)
            VALUES (${conversationId}, ${userId}) ON CONFLICT DO NOTHING`;
        }
      },
      advanceRead: async (conversationId, userId, seq) => {
        await tx`INSERT INTO chat.read_cursors (conversation_id, user_id, last_read_seq)
          VALUES (${conversationId}, ${userId}, ${seq})
          ON CONFLICT (conversation_id, user_id) DO UPDATE
            SET last_read_seq = GREATEST(chat.read_cursors.last_read_seq, EXCLUDED.last_read_seq)`;
      },
      advanceDelivered: async (conversationId, userId, seq) => {
        await tx`INSERT INTO chat.read_cursors (conversation_id, user_id, last_delivered_seq)
          VALUES (${conversationId}, ${userId}, ${seq})
          ON CONFLICT (conversation_id, user_id) DO UPDATE
            SET last_delivered_seq =
              GREATEST(chat.read_cursors.last_delivered_seq, EXCLUDED.last_delivered_seq)`;
      },
      lastRead: async (conversationId, userId) =>
        Number(
          (
            await tx`SELECT last_read_seq::int AS n FROM chat.read_cursors
              WHERE conversation_id = ${conversationId} AND user_id = ${userId}`
          )[0]?.n ?? 0,
        ),
      get: async (conversationId, userId) => {
        const [row] =
          await tx`SELECT last_read_seq::int AS read, last_delivered_seq::int AS delivered
          FROM chat.read_cursors WHERE conversation_id = ${conversationId} AND user_id = ${userId}`;
        return { readSeq: Number(row?.read ?? 0), deliveredSeq: Number(row?.delivered ?? 0) };
      },
      removeForUser: async (userId) =>
        (await tx`DELETE FROM chat.read_cursors WHERE user_id = ${userId}`).count,
    },
    settings: {
      sharing: async (userIds) => {
        const rows =
          userIds.length === 0
            ? []
            : await tx`SELECT user_id FROM chat.member_settings
                WHERE user_id = ANY(${userIds}) AND share_read_receipts`;
        return new Set(rows.map((r) => /** @type {string} */ (r.userId)));
      },
      put: async (userId, shareReadReceipts, at) => {
        await tx`INSERT INTO chat.member_settings (user_id, share_read_receipts, updated_at)
          VALUES (${userId}, ${shareReadReceipts}, ${at})
          ON CONFLICT (user_id) DO UPDATE
            SET share_read_receipts = EXCLUDED.share_read_receipts, updated_at = EXCLUDED.updated_at`;
      },
      remove: async (userId) =>
        (await tx`DELETE FROM chat.member_settings WHERE user_id = ${userId}`).count,
    },
  };
}
