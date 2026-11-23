// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createMetrics, createOpsGauges } from '../../src/platform/metrics.js';

/** @param {{ failDb?: boolean }} [options] */
function setup({ failDb = false } = {}) {
  let time = 1_000_000;
  const reads = vi.fn(async () => {
    if (failDb) throw new Error('db down');
    return [[{ lag: 3, unpublished: 2 }], [{ age: null }]];
  });
  const queue = { getJobs: async () => [{ timestamp: time - 4_000 }] };
  const dlq = { getJobCounts: async () => ({ waiting: 1, delayed: 2, prioritized: 0 }) };
  const logger = { warn: vi.fn() };
  const metrics = createMetrics();
  const ops = createOpsGauges({
    metrics,
    db: /** @type {any} */ ({ read: () => reads() }),
    jobs: /** @type {any} */ ({ queue: () => queue, deadLetterQueue: () => dlq }),
    queueNames: ['fast'],
    logger: /** @type {any} */ (logger),
    now: () => time,
  });
  return { ops, metrics, reads, logger, advance: (/** @type {number} */ ms) => (time += ms) };
}

describe('ops gauges (Phase 15)', () => {
  it('collects at most once per 10 s and shares a run between concurrent scrapes', async () => {
    const { ops, metrics, reads, advance } = setup();
    await Promise.all([ops.collect(), ops.collect()]);
    await ops.collect();
    expect(reads).toHaveBeenCalledTimes(1);
    advance(10_001);
    await ops.collect();
    expect(reads).toHaveBeenCalledTimes(2);
    const text = await metrics.registry.metrics();
    expect(text).toContain('vouch_outbox_lag_seconds 3');
    expect(text).toContain('vouch_dead_letter_jobs{queue="fast"} 3');
    expect(text).toContain('vouch_queue_oldest_waiting_seconds{queue="fast"} 4');
    // No backup recorded yet: the gauge is absent, so the alert can use absent().
    expect(text).not.toContain('vouch_backup_age_seconds ');
  });

  it('logs a failed read and still serves the queue gauges', async () => {
    const { ops, metrics, logger } = setup({ failDb: true });
    await ops.collect();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(await metrics.registry.metrics()).toContain('vouch_dead_letter_jobs{queue="fast"} 3');
  });
});
