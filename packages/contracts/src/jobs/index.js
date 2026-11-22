// @ts-check
import { z } from 'zod';
import { Timestamp, Uuidv7 } from '../common/ids.js';

/** Job classes, one BullMQ queue each. Event consumers use `evt.<module>` queues instead. */
export const QueueClass = z.enum(['fast', 'bulk', 'media', 'external']);

/**
 * @typedef {object} JobDefinition
 * @property {string} name  `<module>.<job>`.
 * @property {'fast' | 'bulk' | 'media' | 'external'} queue
 * @property {string} description
 * @property {z.ZodObject} payload
 */

/**
 * @param {JobDefinition} job
 * @returns {Readonly<JobDefinition>}
 */
function defineJob(job) {
  if (!/^[a-z]+\.[a-zA-Z]+$/.test(job.name))
    throw new Error(`job name must be module.job: ${job.name}`);
  QueueClass.parse(job.queue);
  return Object.freeze(job);
}

/** Every v1 job. Payloads hold ids, never personal data or message bodies. */
export const JOBS = Object.freeze(
  Object.fromEntries(
    [
      defineJob({
        name: 'discovery.buildDeck',
        queue: 'fast',
        description: 'Build the top-50 deck for one user (jobId `deck:{userId}` deduplicates).',
        payload: z.strictObject({
          userId: Uuidv7,
          reason: z.enum(['initial', 'refill', 'eligibility_changed']),
        }),
      }),
      defineJob({
        name: 'matching.writePasses',
        queue: 'bulk',
        description: 'Insert a batch of passes in one statement.',
        payload: z.strictObject({
          passes: z
            .array(z.strictObject({ swiperId: Uuidv7, targetId: Uuidv7, swipedAt: Timestamp }))
            .min(1)
            .max(500),
        }),
      }),
      defineJob({
        name: 'matching.purgePasses',
        queue: 'bulk',
        description: 'Delete passes older than the cutoff in one partition, 5,000 rows per batch.',
        payload: z.strictObject({ partition: z.int().min(0).max(15), olderThan: Timestamp }),
      }),
      defineJob({
        name: 'media.processImage',
        queue: 'media',
        description: 'Validate, strip EXIF, resize to WebP variants and moderate one upload.',
        payload: z.strictObject({ uploadId: Uuidv7, userId: Uuidv7 }),
      }),
      defineJob({
        name: 'notifications.sendPush',
        queue: 'external',
        description: 'Send one push through the push provider and log the delivery.',
        payload: z.strictObject({
          deliveryId: Uuidv7,
          userId: Uuidv7,
          template: z.enum(['match.new', 'message.new', 'likes.digest']),
          params: z.record(z.string().regex(/^[a-zA-Z]+$/), z.string().max(200)),
        }),
      }),
      defineJob({
        name: 'notifications.checkReceipts',
        queue: 'external',
        description: 'Check push receipts and remove invalid tokens.',
        payload: z.strictObject({
          ticketIds: z.array(z.string().min(1).max(100)).min(1).max(1000),
        }),
      }),
      defineJob({
        name: 'identity.retention',
        queue: 'bulk',
        description: 'Purge expired or revoked sessions, revoked devices and erased accounts.',
        payload: z.strictObject({
          task: z.enum(['sessions', 'devices', 'deletedUsers']),
          olderThan: Timestamp,
        }),
      }),
      defineJob({
        name: 'platform.retention',
        queue: 'bulk',
        description: 'Run one nightly retention task (see docs/data-model.md, Retention).',
        payload: z.strictObject({
          task: z.enum([
            'outbox',
            'inbox',
            'sessions',
            'devices',
            'uploads',
            'deliveries',
            'messages',
            'reports',
            'bans',
            'auditLog',
            'verificationImages',
            'deletionTasks',
            'deletedUsers',
          ]),
          olderThan: Timestamp,
        }),
      }),
    ].map((job) => [job.name, job]),
  ),
);
