// @ts-check
import { JOBS } from '@vouch/contracts';

/** @type {Map<string, { queue: string, payload: import('zod').ZodType }>} */
const JOB_DEFINITIONS = new Map(Object.entries(JOBS));
import { Queue, Worker } from 'bullmq';
import { runWithContext } from './context.js';

/** Retry policy per queue class. Event-consumer queues (`evt.<module>`) use `events`. */
export const QUEUE_POLICIES = Object.freeze({
  fast: { attempts: 5, baseDelayMs: 500, maxDelayMs: 30_000, concurrency: 10 },
  bulk: { attempts: 5, baseDelayMs: 2_000, maxDelayMs: 300_000, concurrency: 2 },
  media: { attempts: 3, baseDelayMs: 5_000, maxDelayMs: 300_000, concurrency: 2 },
  external: { attempts: 8, baseDelayMs: 1_000, maxDelayMs: 600_000, concurrency: 5 },
  events: { attempts: 8, baseDelayMs: 1_000, maxDelayMs: 600_000, concurrency: 5 },
});

/** @typedef {keyof typeof QUEUE_POLICIES} PolicyName */

/**
 * Exponential backoff with full jitter: a random delay between 0 and min(max, base * 2^n).
 * @param {number} attemptsMade  1 after the first failure.
 * @param {{ baseDelayMs: number, maxDelayMs: number }} policy
 * @param {() => number} [random]
 * @returns {number}
 */
export function backoffDelay(attemptsMade, policy, random = Math.random) {
  const ceiling = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attemptsMade - 1),
  );
  return Math.floor(random() * ceiling);
}

/**
 * @param {string} queueName
 * @returns {PolicyName}
 */
function policyFor(queueName) {
  if (queueName.startsWith('evt.')) return 'events';
  if (Object.hasOwn(QUEUE_POLICIES, queueName)) return /** @type {PolicyName} */ (queueName);
  throw new Error(`unknown queue: ${queueName}`);
}

/**
 * @typedef {object} JobRunner
 * @property {(queueName: string) => Queue} queue
 * @property {(name: string, payload: unknown, opts?: import('bullmq').JobsOptions) => Promise<import('bullmq').Job>} add
 *   Adds a job declared in the contracts (`JOBS`); validates the payload and picks its queue.
 * @property {(queueName: string, handlers: Record<string, (job: import('bullmq').Job) => Promise<unknown>>) => Worker} process
 * @property {(id: string, pattern: string, name: string, payload: unknown) => Promise<void>} schedule
 *   Repeatable job (cron, UTC); BullMQ runs each occurrence once across all workers.
 * @property {(queueName: string) => Queue} deadLetterQueue  `dlq.<queue>`, for inspection and replay.
 * @property {() => Promise<void>} close
 */

/**
 * Creates the job runner on BullMQ.
 * @param {{
 *   connection: import('bullmq').ConnectionOptions,
 *   logger: import('pino').Logger,
 *   prefix?: string,
 *   random?: () => number,
 * }} options
 * @returns {JobRunner}
 */
export function createJobs({ connection, logger, prefix = 'bull', random = Math.random }) {
  /** @type {Map<string, Queue>} */
  const queues = new Map();
  /** @type {Worker[]} */
  const workers = [];

  /** @param {string} name */
  const queue = (name) => {
    let existing = queues.get(name);
    if (!existing) {
      const policy = QUEUE_POLICIES[policyFor(name)];
      existing = new Queue(name, {
        connection,
        prefix,
        defaultJobOptions: {
          attempts: policy.attempts,
          backoff: { type: 'jittered' },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      });
      queues.set(name, existing);
    }
    return existing;
  };

  /** @type {JobRunner['add']} */
  const add = async (name, payload, opts = {}) => {
    const definition = JOB_DEFINITIONS.get(name);
    if (!definition) throw new Error(`unknown job: ${name}`);
    const data = definition.payload.parse(payload);
    return queue(definition.queue).add(name, data, opts);
  };

  /** @type {JobRunner['process']} */
  const process = (queueName, handlers) => {
    const policy = QUEUE_POLICIES[policyFor(queueName)];
    const worker = new Worker(
      queueName,
      async (job) => {
        const handler = handlers[job.name];
        if (!handler) throw new Error(`no handler for ${job.name} on ${queueName}`);
        return runWithContext({ traceId: job.data?.traceId ?? null }, () => handler(job));
      },
      {
        connection,
        prefix,
        concurrency: policy.concurrency,
        settings: { backoffStrategy: (attemptsMade) => backoffDelay(attemptsMade, policy, random) },
      },
    );
    worker.on('failed', (job, err) => {
      if (!job) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      logger.warn(
        { queue: queueName, job: job.name, jobId: job.id, attempts: job.attemptsMade, err },
        'job failed',
      );
      if (exhausted) {
        // Dead-letter: a copy of the failed job goes to `dlq.<queue>` for inspection and replay.
        void deadLetterQueue(queueName)
          .add(job.name, {
            queue: queueName,
            jobId: job.id,
            data: job.data,
            failedReason: err.message,
          })
          .catch((dlqError) => logger.error({ err: dlqError }, 'dead-letter enqueue failed'));
      }
    });
    worker.on('error', (err) => logger.error({ queue: queueName, err }, 'worker error'));
    workers.push(worker);
    return worker;
  };

  /** @type {Map<string, Queue>} */
  const dlqs = new Map();
  /** @param {string} queueName */
  const deadLetterQueue = (queueName) => {
    let dlq = dlqs.get(queueName);
    if (!dlq) {
      dlq = new Queue(`dlq.${queueName}`, { connection, prefix });
      dlqs.set(queueName, dlq);
    }
    return dlq;
  };

  /** @type {JobRunner['schedule']} */
  const schedule = async (id, pattern, name, payload) => {
    const definition = JOB_DEFINITIONS.get(name);
    const queueName = definition ? definition.queue : 'bulk';
    await queue(queueName).upsertJobScheduler(id, { pattern, tz: 'UTC' }, { name, data: payload });
  };

  return {
    queue,
    add,
    process,
    schedule,
    close: async () => {
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([...queues.values(), ...dlqs.values()].map((q) => q.close()));
    },
    deadLetterQueue,
  };
}
