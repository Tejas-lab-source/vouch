// @ts-check

export const RELAY_BATCH_SIZE = 200;
export const RELAY_BUSY_INTERVAL_MS = 200;
export const RELAY_IDLE_INTERVAL_MS = 2_000;

/**
 * Queue name for one consumer module's event subscriptions.
 * @param {string} consumer
 */
export const eventQueueName = (consumer) => `evt.${consumer}`;

/**
 * Job id for one event delivered to one consumer. BullMQ refuses ':' in custom ids, so the
 * roadmap's `<consumer>:<outboxId>` is written `<consumer>-<outboxId>`.
 * @param {string} consumer
 * @param {number} eventId
 */
export const eventJobId = (consumer, eventId) => `${consumer}-${eventId}`;

/**
 * @typedef {object} Relay
 * @property {() => Promise<number>} relayOnce  Publishes one batch; returns the rows published.
 * @property {() => void} start  Loops: every 200 ms while busy, every 2 s when idle.
 * @property {() => Promise<void>} stop  Stops the loop after the current batch.
 */

/**
 * Creates the outbox relay. Rows are locked with `FOR UPDATE SKIP LOCKED`, so several relays
 * can run in parallel without publishing an event twice. Each event fans out to one queue per
 * subscribing module, with a job id that BullMQ deduplicates.
 * @param {{
 *   db: import('../db.js').Database,
 *   jobs: import('../jobs.js').JobRunner,
 *   subscriptions: ReadonlyMap<string, readonly string[]>,
 *   logger: import('pino').Logger,
 *   batchSize?: number,
 * }} options
 * @returns {Relay}
 */
export function createRelay({ db, jobs, subscriptions, logger, batchSize = RELAY_BATCH_SIZE }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let running = false;
  /** @type {Promise<unknown>} */
  let current = Promise.resolve();

  const relayOnce = () =>
    db.transaction('platform', async (tx) => {
      const rows = await tx`
        SELECT id, name, version, payload, trace_id, created_at
        FROM platform.outbox
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        const envelope = {
          id: Number(row.id),
          name: row.name,
          version: row.version,
          occurredAt: new Date(row.createdAt).toISOString(),
          traceId: row.traceId,
          payload: row.payload,
        };
        for (const consumer of subscriptions.get(row.name) ?? []) {
          await jobs
            .queue(eventQueueName(consumer))
            .add(row.name, envelope, { jobId: eventJobId(consumer, envelope.id) });
        }
      }
      if (rows.length > 0) {
        await tx`UPDATE platform.outbox SET published_at = now() WHERE id IN ${tx(rows.map((r) => r.id))}`;
      }
      return rows.length;
    });

  const tick = async () => {
    if (!running) return;
    let published = 0;
    try {
      published = await relayOnce();
    } catch (err) {
      logger.error({ err }, 'outbox relay failed');
    }
    if (running) {
      timer = setTimeout(
        () => {
          current = tick();
        },
        published > 0 ? RELAY_BUSY_INTERVAL_MS : RELAY_IDLE_INTERVAL_MS,
      );
    }
  };

  return {
    relayOnce,
    start: () => {
      if (running) return;
      running = true;
      current = tick();
    },
    stop: async () => {
      running = false;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}
