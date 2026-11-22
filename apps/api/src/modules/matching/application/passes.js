// @ts-check

/** Passes per insert statement (roadmap Phase 8). */
export const PASS_BATCH = 500;
/** Batches moved per flush run, so one run stays short. */
const MAX_BATCHES_PER_FLUSH = 20;

/**
 * Pass batching (owner decision, Phase 8): swipes push passes to a Redis buffer; every 5 s (or
 * at 500) `flushPasses` moves them into `matching.writePasses` jobs, which insert up to 500
 * per statement. Losing buffered passes when Redis is wiped is accepted.
 * @param {Pick<import('../ports.js').MatchingDeps, 'uow' | 'passes' | 'queue'>} deps
 */
export function makePassBatching({ uow, passes, queue }) {
  /** Drains the buffer into durable write jobs. */
  async function flushPasses() {
    let moved = 0;
    for (let i = 0; i < MAX_BATCHES_PER_FLUSH; i += 1) {
      const batch = await passes.take(PASS_BATCH);
      if (batch.length === 0) break;
      await queue.enqueueWrite(batch);
      moved += batch.length;
      if (batch.length < PASS_BATCH) break;
    }
    return { moved };
  }

  /**
   * Inserts one batch in one statement. Passes by or for accounts no longer active are
   * dropped; a pass for a pair already swiped (for example a later like) is a no-op.
   * @param {{ passes: { swiperId: string, targetId: string, swipedAt: string }[] }} input
   */
  async function writePassesBatch({ passes: batch }) {
    const written = await uow.run(({ stores }) => stores.swipes.insertPasses(batch));
    await passes.settle(batch);
    return { written };
  }

  return { flushPasses, writePassesBatch };
}
