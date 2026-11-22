// @ts-check

/**
 * Jobs matching queues on the `bulk` queue.
 * @param {{ jobs: import('../../../../platform/jobs.js').JobRunner }} deps
 */
export function createMatchingQueue({ jobs }) {
  return {
    /** @param {readonly { swiperId: string, targetId: string, swipedAt: string }[]} passes */
    enqueueWrite: async (passes) => {
      await jobs.add('matching.writePasses', { passes });
    },
    /** An early flush when the buffer reaches 500 (deduplicated while one is queued). */
    enqueueFlush: async () => {
      await jobs.add(
        'matching.flushPasses',
        {},
        { jobId: 'passes-flush', removeOnComplete: true, removeOnFail: true },
      );
    },
  };
}
