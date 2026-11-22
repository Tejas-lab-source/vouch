// @ts-check

/**
 * Chat's part of the data export: the messages the user sent (never the other person's).
 * @param {Pick<import('../ports.js').ChatDeps, 'read'>} deps
 */
export function makeChatExport({ read }) {
  /** @param {string} userId */
  return async (userId) => ({
    sentMessages: (await read((stores) => stores.messages.sentBy(userId))).map((m) => ({
      conversationId: m.conversationId,
      seq: m.seq,
      kind: m.kind,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
