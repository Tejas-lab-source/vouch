// @ts-check

/** Messages are kept until a conversation has been closed for 30 days (docs/data-model.md). */
export const CLOSED_RETENTION_MS = 30 * 24 * 3600 * 1000;
const BATCH = 5000;

/**
 * Nightly `chat.retentionTick`: deletes messages of conversations closed more than 30 days ago,
 * 5,000 per statement.
 * @param {Pick<import('../ports.js').ChatDeps, 'uow' | 'clock'>} deps
 */
export function makeChatRetention({ uow, clock }) {
  return async function purgeClosed() {
    const olderThan = new Date(clock.now().getTime() - CLOSED_RETENTION_MS);
    let deleted = 0;
    for (;;) {
      const n = await uow.run(({ stores }) => stores.messages.purgeClosed(olderThan, BATCH));
      deleted += n;
      if (n < BATCH) return { deleted };
    }
  };
}
