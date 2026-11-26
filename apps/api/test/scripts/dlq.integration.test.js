// @ts-check
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deadLetterQueues, listDeadLetters, replayDeadLetters } from '../../scripts/dlq.js';
import { createJobs } from '../../src/platform/jobs.js';
import { createRedis } from '../../src/platform/redis.js';
import { eventually, HOOK_TIMEOUT_MS, startInfra } from '../platform/helpers.js';

describe('dead-letter list and replay (scripts/dlq.js, Phase 15)', () => {
  /** @type {Awaited<ReturnType<typeof startInfra>>} */
  let infra;
  /** @type {ReturnType<typeof createRedis>} */
  let redis;
  beforeAll(async () => {
    infra = await startInfra();
    redis = createRedis({ url: infra.redisUrl });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await redis?.quit();
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('a job that failed every retry is listed without its payload, then replayed once', async () => {
    const jobs = createJobs({
      connection: redis.bullmq,
      logger: pino({ level: 'silent' }),
      random: () => 0,
    });
    let fail = true;
    /** @type {unknown[]} */
    const seen = [];
    jobs.process('evt.chat', {
      'match.created.v1': async (job) => {
        if (fail) throw new Error('downstream unavailable');
        seen.push(job.data);
      },
    });
    const payload = { id: 7, name: 'match.created.v1', payload: { secret: 'private text' } };
    await jobs.queue('evt.chat').add('match.created.v1', payload, {
      jobId: 'chat-7',
      attempts: 2,
      backoff: { type: 'fixed', delay: 10 },
    });
    await eventually(
      async () => (await jobs.deadLetterQueue('evt.chat').getJobCounts('waiting')).waiting === 1,
      20_000,
    );

    expect(await deadLetterQueues(redis.command)).toEqual(['evt.chat']);
    const [listing] = await listDeadLetters({ jobs, queues: ['evt.chat'] });
    expect(listing?.jobs).toHaveLength(1);
    expect(listing?.jobs[0]).toMatchObject({
      name: 'match.created.v1',
      originalId: 'chat-7',
      failedReason: 'downstream unavailable',
    });
    expect(JSON.stringify(listing)).not.toContain('private text');

    fail = false;
    expect(await replayDeadLetters({ jobs, queue: 'evt.chat' })).toBe(1);
    await eventually(async () => seen.length === 1, 10_000);
    expect(seen[0]).toEqual(payload);
    expect((await jobs.deadLetterQueue('evt.chat').getJobCounts('waiting')).waiting).toBe(0);
    expect(await replayDeadLetters({ jobs, queue: 'evt.chat' })).toBe(0);
    await jobs.close();
  }, 60_000);
});
