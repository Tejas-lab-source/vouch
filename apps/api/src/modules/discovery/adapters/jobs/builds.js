// @ts-check

/**
 * Queues `discovery.buildDeck` with job id `deck-{uid}` (BullMQ ids cannot contain `:`). While
 * a build is waiting or running, further requests are dropped; finished jobs are removed at
 * once so the next refill can be queued.
 * @param {{ jobs: import('../../../../platform/jobs.js').JobRunner }} deps
 */
export function createBuildQueue({ jobs }) {
  return {
    /** @param {string} userId @param {'initial' | 'refill' | 'eligibility_changed'} reason */
    enqueueBuild: async (userId, reason) => {
      await jobs.add(
        'discovery.buildDeck',
        { userId, reason },
        { jobId: `deck-${userId}`, removeOnComplete: true, removeOnFail: true },
      );
    },
  };
}
