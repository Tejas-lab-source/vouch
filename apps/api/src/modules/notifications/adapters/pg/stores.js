// @ts-check

/**
 * Postgres stores of notifications (role `vouch_notifications`), bound to one transaction.
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').NotificationStores}
 */
export function createNotificationStores(tx) {
  return {
    prefs: {
      find: async (userId) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM notifications.prefs WHERE user_id = ${userId}`)[0]
        ) ?? null,
      upsert: async (userId, p, at) => {
        await tx`INSERT INTO notifications.prefs (user_id, push_matches, push_messages, push_likes_digest,
            quiet_start_minute, quiet_end_minute, timezone, updated_at)
          VALUES (${userId}, ${p.pushMatches}, ${p.pushMessages}, ${p.pushLikesDigest},
            ${p.quietHours?.startMinute ?? null}, ${p.quietHours?.endMinute ?? null}, ${p.timezone}, ${at})
          ON CONFLICT (user_id) DO UPDATE SET push_matches = EXCLUDED.push_matches,
            push_messages = EXCLUDED.push_messages, push_likes_digest = EXCLUDED.push_likes_digest,
            quiet_start_minute = EXCLUDED.quiet_start_minute, quiet_end_minute = EXCLUDED.quiet_end_minute,
            timezone = EXCLUDED.timezone, updated_at = EXCLUDED.updated_at`;
      },
    },
    deliveries: {
      insert: async (d) =>
        (
          await tx`INSERT INTO notifications.deliveries (id, user_id, template, status, dedupe_key, error_code, created_at)
            VALUES (${d.id}, ${d.userId}, ${d.template}, ${d.status}, ${d.dedupeKey}, ${d.errorCode}, ${d.createdAt})
            ON CONFLICT (dedupe_key) DO NOTHING`
        ).count === 1,
      find: async (id) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM notifications.deliveries WHERE id = ${id}`)[0]
        ) ?? null,
      finish: async (id, { status, ticketId, errorCode, at }) => {
        await tx`UPDATE notifications.deliveries SET status = ${status},
            provider_ticket_id = ${ticketId}, error_code = ${errorCode},
            sent_at = ${status === 'sent' ? at : null}
          WHERE id = ${id}`;
      },
      purge: async (olderThan) =>
        (await tx`DELETE FROM notifications.deliveries WHERE created_at < ${olderThan}`).count,
    },
    erasure: {
      eraseUser: async (userId) => {
        await tx`DELETE FROM notifications.prefs WHERE user_id = ${userId}`;
        await tx`DELETE FROM notifications.deliveries WHERE user_id = ${userId}`;
      },
    },
  };
}
