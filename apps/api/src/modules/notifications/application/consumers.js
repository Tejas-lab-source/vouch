// @ts-check

/**
 * Notifications' event consumers. They only decide and queue; sending happens in
 * `notifications.sendPush`.
 * @param {import('../ports.js').NotificationDeps & ReturnType<typeof import('./push.js').makePush>} deps
 */
export function makeNotificationConsumers(deps) {
  const { queue, cancelBetween, chat, redis, settings, email, storesFor, logger } = deps;

  return {
    /**
     * `match.created.v1`: one push to the user who liked first (the other just saw the match
     * on screen).
     * @param {{ matchId: string, firstLikerId: string, userLow: string, userHigh: string }} payload
     */
    async onMatchCreated(payload) {
      const other = payload.firstLikerId === payload.userLow ? payload.userHigh : payload.userLow;
      await queue({
        userId: payload.firstLikerId,
        template: 'match.new',
        params: { matchId: payload.matchId },
        dedupeKey: `match:${payload.matchId}`,
        from: other,
      });
    },

    /**
     * `message.created.v1` (emitted when the recipient was offline): pushes if they are still
     * offline, at most once per conversation per `PUSH_MESSAGE_BATCH_SECONDS` (30 s) — later
     * messages in the window are logged as suppressed.
     * @param {{ conversationId: string, seq: number, senderId: string, recipientId: string }} payload
     */
    async onMessageCreated(payload) {
      if (await chat.isActiveRecently(payload.recipientId)) return;
      const windowKey = `notifications:batch:${payload.recipientId}:${payload.conversationId}`;
      const first = await redis.set(windowKey, '1', 'EX', settings.messageBatchSeconds, 'NX');
      await queue({
        userId: payload.recipientId,
        template: 'message.new',
        params: { conversationId: payload.conversationId },
        dedupeKey: `message:${payload.conversationId}:${payload.seq}`,
        from: payload.senderId,
        batched: first !== 'OK',
      });
    },

    /**
     * `user.blocked.v1`: nothing still queued may reach either person from the other.
     * @param {{ blockerId: string, blockedId: string }} payload
     */
    async onUserBlocked({ blockerId, blockedId }) {
      await cancelBetween(blockerId, blockedId);
    },

    /**
     * `report.created.v1`: emails staff (ids and reason only) when ADMIN_ALERT_EMAIL is set.
     * A failed email is logged, not retried forever: the queue itself is the source of truth.
     * @param {{ reportId: string, reason: string, context: string }} payload
     */
    async onReportCreated(payload) {
      if (!settings.alertEmail) return;
      await email
        .send({
          to: settings.alertEmail,
          subject: `New report (${payload.reason})`,
          text: `A ${payload.context} report (${payload.reason}) is waiting in the moderation queue. Report id: ${payload.reportId}.`,
        })
        .catch((err) =>
          logger.error({ err, reportId: payload.reportId }, 'report alert email failed'),
        );
    },

    /**
     * `user.deleted.v1`: preferences and the delivery log go.
     * @param {{ userId: string }} payload
     * @param {{ tx: import('postgres').TransactionSql }} context
     */
    async onUserDeleted({ userId }, { tx }) {
      await storesFor(tx).erasure.eraseUser(userId);
    },
  };
}
