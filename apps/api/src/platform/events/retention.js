// @ts-check

/** How long processed event bookkeeping is kept (docs/data-model.md, Retention). */
export const EVENT_RETENTION = Object.freeze({
  outbox: 7 * 24 * 3600 * 1000,
  inbox: 30 * 24 * 3600 * 1000,
});

const DELETE_BATCH = 5_000;

/**
 * Deletes published outbox rows and inbox rows older than their retention, in batches.
 * @param {import('../db.js').Database} db
 * @param {'outbox' | 'inbox'} task
 * @param {Date} olderThan
 * @returns {Promise<number>} Rows deleted.
 */
export async function purgeEvents(db, task, olderThan) {
  let total = 0;
  for (;;) {
    const deleted = await db.transaction('platform', (tx) =>
      task === 'outbox'
        ? tx`
          DELETE FROM platform.outbox WHERE id IN (
            SELECT id FROM platform.outbox
            WHERE published_at IS NOT NULL AND published_at < ${olderThan}
            LIMIT ${DELETE_BATCH})`
        : tx`
          DELETE FROM platform.inbox WHERE (consumer, event_id) IN (
            SELECT consumer, event_id FROM platform.inbox
            WHERE processed_at < ${olderThan}
            LIMIT ${DELETE_BATCH})`,
    );
    total += deleted.count;
    if (deleted.count < DELETE_BATCH) return total;
  }
}
