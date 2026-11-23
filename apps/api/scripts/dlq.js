// @ts-check
/**
 * Dead-letter queues (Phase 15, docs/OPERATIONS.md): list what failed every retry, and replay
 * it once the cause is fixed. Run in the Render shell:
 *
 *   node scripts/dlq.js list
 *   node scripts/dlq.js replay --queue evt.chat [--job <dead-letter job id>]
 *
 * `list` prints names, ids and failure reasons only, never payloads (they may hold personal
 * data). `replay` re-queues each job under a new id (the failed original may still hold its
 * id) and removes it from the dead-letter queue. Handlers and event consumers are idempotent
 * (the inbox), so a replay is safe.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pino from 'pino';
import { createJobs } from '../src/platform/jobs.js';
import { createRedis } from '../src/platform/redis.js';

const STATES = /** @type {const} */ (['waiting', 'delayed', 'prioritized']);

/**
 * Dead-letter queue names present in Redis (`<prefix>:dlq.<queue>:…`).
 * @param {import('ioredis').Redis} redis
 * @param {string} prefix
 */
export async function deadLetterQueues(redis, prefix = 'bull') {
  const names = new Set();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:dlq.*:meta`, 'COUNT', 500);
    cursor = next;
    for (const key of keys)
      names.add(key.slice(prefix.length + 1 + 'dlq.'.length, -':meta'.length));
  } while (cursor !== '0');
  return [...names].sort();
}

/**
 * @param {{ jobs: import('../src/platform/jobs.js').JobRunner, queues: string[] }} deps
 */
export async function listDeadLetters({ jobs, queues }) {
  const out = [];
  for (const queue of queues) {
    const entries = await jobs.deadLetterQueue(queue).getJobs([...STATES], 0, 199, true);
    out.push({
      queue,
      jobs: entries.map((job) => ({
        id: String(job.id),
        name: job.name,
        originalId: String(job.data?.jobId ?? ''),
        failedReason: String(job.data?.failedReason ?? '').slice(0, 200),
        failedAt: new Date(job.timestamp).toISOString(),
      })),
    });
  }
  return out;
}

/**
 * @param {{ jobs: import('../src/platform/jobs.js').JobRunner, queue: string, only?: string, now?: () => number }} deps
 * @returns {Promise<number>} jobs replayed
 */
export async function replayDeadLetters({ jobs, queue, only, now = Date.now }) {
  const dlq = jobs.deadLetterQueue(queue);
  const target = jobs.queue(queue);
  let replayed = 0;
  for (const job of await dlq.getJobs([...STATES], 0, -1, true)) {
    if (only && String(job.id) !== only) continue;
    await target.add(job.name, job.data?.data, {
      jobId: `${job.data?.jobId ?? job.id}-replay-${now()}`,
    });
    await job.remove();
    replayed += 1;
  }
  return replayed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { queue: { type: 'string' }, job: { type: 'string' } },
  });
  const url = process.env.REDIS_URL;
  const run = async () => {
    if (!url) throw new Error('REDIS_URL is not set');
    const redis = createRedis({ url });
    const jobs = createJobs({ connection: redis.bullmq, logger: pino({ level: 'silent' }) });
    try {
      if (positionals[0] === 'list') {
        const listing = await listDeadLetters({
          jobs,
          queues: await deadLetterQueues(redis.command),
        });
        for (const { queue, jobs: entries } of listing) {
          process.stdout.write(`dlq.${queue}: ${entries.length}\n`);
          for (const j of entries) {
            process.stdout.write(
              `  ${j.id}  ${j.name}  (was ${j.originalId}, ${j.failedAt}): ${j.failedReason}\n`,
            );
          }
        }
        if (listing.length === 0) process.stdout.write('no dead-letter queues\n');
      } else if (positionals[0] === 'replay' && values.queue) {
        const n = await replayDeadLetters({ jobs, queue: values.queue, only: values.job });
        process.stdout.write(`replayed ${n} job(s) into ${values.queue}\n`);
      } else {
        throw new Error('usage: dlq.js list | replay --queue <queue> [--job <id>]');
      }
    } finally {
      await jobs.close();
      await redis.quit();
    }
  };
  run().catch((error) => {
    process.stderr.write(`dlq failed: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
