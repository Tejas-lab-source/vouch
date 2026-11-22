// @ts-check

/** Passes are kept 30 days (docs/data-model.md, Retention). */
export const PASS_RETENTION_MS = 30 * 24 * 3600 * 1000;
export const PARTITIONS = 16;
const PURGE_BATCH = 5000;

/**
 * Nightly retention: the tick queues one `matching.purgePasses` per partition; each deletes
 * passes older than the cutoff in batches of 5,000 until none are left. Likes are kept.
 * @param {Pick<import('../ports.js').MatchingDeps, 'uow' | 'clock'> & { addJob: (name: string, payload: unknown) => Promise<unknown> }} deps
 */
export function makeRetention({ uow, clock, addJob }) {
  return {
    async retentionTick() {
      const olderThan = new Date(clock.now().getTime() - PASS_RETENTION_MS).toISOString();
      for (let partition = 0; partition < PARTITIONS; partition += 1) {
        await addJob('matching.purgePasses', { partition, olderThan });
      }
      return { queued: PARTITIONS };
    },
    /** @param {{ partition: number, olderThan: string }} input */
    async purgePasses({ partition, olderThan }) {
      let deleted = 0;
      for (;;) {
        const n = await uow.run(({ stores }) =>
          stores.swipes.purgePasses(partition, new Date(olderThan), PURGE_BATCH),
        );
        deleted += n;
        if (n < PURGE_BATCH) return { deleted };
      }
    },
  };
}
