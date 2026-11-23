// @ts-check
import { defineEvent } from '@vouch/contracts';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase } from '../../src/platform/db.js';
import { createConsumer } from '../../src/platform/events/consume.js';
import { createRelay, eventJobId, eventQueueName } from '../../src/platform/events/relay.js';
import { purgeEvents } from '../../src/platform/events/retention.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { createJobs } from '../../src/platform/jobs.js';
import { createRedis } from '../../src/platform/redis.js';
import { createUnitOfWork } from '../../src/platform/uow.js';
import { eventually, HOOK_TIMEOUT_MS, startInfra } from './helpers.js';

const logger = pino({ level: 'silent' });
const thingHappened = defineEvent({
  name: 'thing.happened.v1',
  producer: 'example',
  description: 'test event',
  payload: z.strictObject({ n: z.int() }),
});

describe('event bus: outbox → relay → per-consumer queues → inbox', () => {
  /** @type {import('./helpers.js').Infra} */
  let infra;
  /** @type {import('../../src/platform/db.js').Database} */
  let db;
  /** @type {import('../../src/platform/redis.js').RedisClients} */
  let redis;
  /** @type {import('../../src/platform/jobs.js').JobRunner} */
  let jobs;
  let prefix = 0;

  beforeAll(async () => {
    infra = await startInfra();
    db = createDatabase({ url: infra.appUrl, extraModules: ['example'] });
    redis = createRedis({ url: infra.redisUrl });
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await jobs?.close();
    await infra.admin`UPDATE platform.outbox SET published_at = now() WHERE published_at IS NULL`;
  });

  afterAll(async () => {
    await redis?.quit();
    await db?.end();
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  /** A fresh BullMQ prefix per test, so queues never collide. */
  const newJobs = () => {
    prefix += 1;
    jobs = createJobs({ connection: redis.bullmq, logger, prefix: `t${prefix}`, random: () => 0 });
    return jobs;
  };

  /** @param {number} n */
  const emit = (n) =>
    createUnitOfWork({ db, module: 'example' }).run(({ emit: e }) => e(thingHappened, { n }));

  it('fans one event out to every subscribing consumer, each running its handler once', async () => {
    const runner = newJobs();
    /** @type {Map<string, number[]>} */
    const seen = new Map([
      ['safety', []],
      ['chat', []],
    ]);
    for (const consumer of ['safety', 'chat']) {
      runner.process(eventQueueName(consumer), {
        [thingHappened.name]: createConsumer({
          db,
          consumer,
          event: thingHappened,
          handler: async (payload) => {
            seen.get(consumer)?.push(payload.n);
          },
        }),
      });
    }
    const relay = createRelay({
      db,
      jobs: runner,
      subscriptions: new Map([[thingHappened.name, ['safety', 'chat']]]),
      logger,
    });
    const id = await emit(1);

    expect(await relay.relayOnce()).toBe(1);
    await eventually(() => seen.get('safety')?.length === 1 && seen.get('chat')?.length === 1);
    const inbox =
      await infra.admin`SELECT consumer FROM platform.inbox WHERE event_id = ${id} ORDER BY consumer`;
    expect(inbox.map((r) => r.consumer)).toEqual(['chat', 'safety']);
    const [row] = await infra.admin`SELECT published_at FROM platform.outbox WHERE id = ${id}`;
    expect(row.published_at).not.toBeNull();
  });

  it('runs the handler once when an event is redelivered', async () => {
    let calls = 0;
    const process = createConsumer({
      db,
      consumer: 'safety',
      event: thingHappened,
      handler: async () => {
        calls += 1;
      },
    });
    const job = {
      data: {
        id: 424242,
        name: thingHappened.name,
        version: 1,
        occurredAt: new Date().toISOString(),
        traceId: null,
        payload: { n: 7 },
      },
    };
    expect(await process(job)).toBe('processed');
    expect(await process(job)).toBe('duplicate');
    expect(await process(job)).toBe('duplicate');
    expect(calls).toBe(1);
  });

  it('a consumer can emit in its transaction; after-commit hooks run only once it commits', async () => {
    /** @type {string[]} */
    const hooks = [];
    let fail = true;
    const process = createConsumer({
      db,
      consumer: 'safety',
      event: thingHappened,
      handler: async (payload, { emit, afterCommit }) => {
        await emit(thingHappened, { n: payload.n + 1000 });
        afterCommit(() => hooks.push(`committed ${payload.n}`));
        afterCommit(() => {
          throw new Error('hooks are best-effort');
        });
        if (fail) throw new Error('transient');
      },
    });
    const job = {
      data: {
        id: 434343,
        name: thingHappened.name,
        version: 1,
        occurredAt: new Date().toISOString(),
        traceId: 'trace-1',
        payload: { n: 8 },
      },
    };
    await expect(process(job)).rejects.toThrow('transient');
    expect(hooks).toEqual([]);
    const emitted = () =>
      infra.admin`SELECT trace_id FROM platform.outbox WHERE payload->>'n' = '1008'`;
    expect(await emitted()).toHaveLength(0);
    fail = false;
    expect(await process(job)).toBe('processed');
    expect(hooks).toEqual(['committed 8']);
    expect((await emitted()).map((r) => r.trace_id)).toEqual(['trace-1']);
  });

  it('jobs: a per-queue concurrency override replaces the policy default', async () => {
    prefix += 1;
    jobs = createJobs({
      connection: redis.bullmq,
      logger,
      prefix: `t${prefix}`,
      concurrency: { media: 1 },
    });
    expect(jobs.process('media', {}).opts.concurrency).toBe(1);
    expect(jobs.process('bulk', {}).opts.concurrency).toBe(2);
  });

  it('a handler failure rolls back its inbox row, so a retry processes it again', async () => {
    let attempts = 0;
    const process = createConsumer({
      db,
      consumer: 'chat',
      event: thingHappened,
      handler: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient');
      },
    });
    const job = {
      data: {
        id: 434343,
        name: thingHappened.name,
        version: 1,
        occurredAt: new Date().toISOString(),
        traceId: null,
        payload: { n: 1 },
      },
    };
    await expect(process(job)).rejects.toThrow('transient');
    expect(await process(job)).toBe('processed');
    expect(attempts).toBe(2);
  });

  it('refuses a malformed event envelope before touching the inbox', async () => {
    const process = createConsumer({
      db,
      consumer: 'chat',
      event: thingHappened,
      handler: async () => {},
    });
    await expect(
      process({ data: { id: 1, name: thingHappened.name, payload: { n: 'x' } } }),
    ).rejects.toThrow();
  });

  it('a failing consumer dead-letters without blocking the other consumer', async () => {
    const runner = newJobs();
    /** @type {number[]} */
    const healthy = [];
    runner.process(eventQueueName('chat'), {
      [thingHappened.name]: createConsumer({
        db,
        consumer: 'chat',
        event: thingHappened,
        handler: async () => {
          throw new Error('always fails');
        },
      }),
    });
    runner.process(eventQueueName('safety'), {
      [thingHappened.name]: createConsumer({
        db,
        consumer: 'safety',
        event: thingHappened,
        handler: async (p) => {
          healthy.push(p.n);
        },
      }),
    });
    const relay = createRelay({
      db,
      jobs: runner,
      subscriptions: new Map([[thingHappened.name, ['chat', 'safety']]]),
      logger,
    });
    const id = await emit(5);
    await relay.relayOnce();

    await eventually(() => healthy.includes(5));
    const dlq = runner.deadLetterQueue(eventQueueName('chat'));
    const dead = await eventually(
      async () =>
        (await dlq.getJobs(['waiting'])).find((j) => j.data.jobId === eventJobId('chat', id)),
      20_000,
    );
    expect(dead?.data.failedReason).toBe('always fails');
    expect(dead?.data.data.payload).toEqual({ n: 5 });
  }, 30_000);

  it('two relays running concurrently never publish an event twice', async () => {
    const runner = newJobs();
    const subscriptions = new Map([[thingHappened.name, ['chat']]]);
    const ids = [];
    for (let n = 0; n < 50; n += 1) ids.push(await emit(n));
    const relays = [1, 2, 3].map(() =>
      createRelay({ db, jobs: runner, subscriptions, logger, batchSize: 7 }),
    );

    let published = 0;
    for (;;) {
      const counts = await Promise.all(relays.map((r) => r.relayOnce()));
      const round = counts.reduce((a, b) => a + b, 0);
      published += round;
      if (round === 0) break;
    }
    expect(published).toBe(50);
    const queued = await runner.queue(eventQueueName('chat')).getJobCounts('waiting');
    expect(queued.waiting).toBe(50);
  });

  it('the relay loop publishes continuously and stops cleanly', async () => {
    const runner = newJobs();
    const relay = createRelay({ db, jobs: runner, subscriptions: new Map(), logger });
    relay.start();
    relay.start();
    const id = await emit(9);
    await eventually(
      async () =>
        (await infra.admin`SELECT published_at FROM platform.outbox WHERE id = ${id}`)[0]
          ?.published_at,
    );
    await relay.stop();
  });

  it('an idle relay wakes on NOTIFY: a new event is published well inside the 2 s poll (Phase 15)', async () => {
    const runner = newJobs();
    const relay = createRelay({ db, jobs: runner, subscriptions: new Map(), logger });
    relay.start();
    // Let the first (empty) batch run, so the loop is waiting on its idle timer.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const latencies = [];
    for (let n = 0; n < 5; n += 1) {
      const started = performance.now();
      const id = await emit(100 + n);
      await eventually(
        async () =>
          (await infra.admin`SELECT published_at FROM platform.outbox WHERE id = ${id}`)[0]
            ?.published_at,
        5_000,
      );
      latencies.push(performance.now() - started);
      // Back to idle before the next event.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await relay.stop();
    expect(Math.max(...latencies)).toBeLessThan(500);
  }, 30_000);

  it('purges published outbox rows and old inbox rows past retention', async () => {
    const id = await emit(11);
    await infra.admin`UPDATE platform.outbox SET published_at = now() - interval '8 days' WHERE id = ${id}`;
    await infra.admin`INSERT INTO platform.inbox (consumer, event_id, processed_at) VALUES ('old', 1, now() - interval '31 days')`;
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    expect(await purgeEvents(db, 'outbox', weekAgo)).toBeGreaterThanOrEqual(1);
    expect(await purgeEvents(db, 'inbox', monthAgo)).toBe(1);
    expect(await infra.admin`SELECT 1 FROM platform.outbox WHERE id = ${id}`).toHaveLength(0);
  });

  it('purges finished deletion tasks after 90 days and keeps unfinished ones (Phase 10)', async () => {
    const [old, recent, open] = [uuidv7(), uuidv7(), uuidv7()];
    await infra.admin`INSERT INTO platform.deletion_tasks (user_id, module, requested_at, completed_at) VALUES
      (${old}, 'chat', now() - interval '100 days', now() - interval '91 days'),
      (${recent}, 'chat', now() - interval '10 days', now() - interval '9 days'),
      (${open}, 'chat', now() - interval '100 days', NULL)`;
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    expect(await purgeEvents(db, 'deletionTasks', cutoff)).toBe(1);
    const left = await infra.admin`SELECT user_id FROM platform.deletion_tasks
      WHERE user_id IN (${old}, ${recent}, ${open})`;
    expect(left.map((r) => r.user_id).sort()).toEqual([recent, open].sort());
  });

  it('jobs: validates payloads against the contracts and schedules repeatable jobs once', async () => {
    const runner = newJobs();
    await expect(runner.add('media.processImage', { uploadId: 'nope' })).rejects.toThrow();
    await expect(runner.add('no.such.job', {})).rejects.toThrow(/unknown job/);
    const job = await runner.add('media.processImage', { uploadId: uuidv7(), userId: uuidv7() });
    expect(job.queueName).toBe('media');
    await runner.schedule('tick', '0 3 * * *', 'platform.retentionTick', {});
    await runner.schedule('tick', '0 3 * * *', 'platform.retentionTick', {});
    expect(await runner.queue('bulk').getJobSchedulersCount()).toBe(1);
  });
});
