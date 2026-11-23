// @ts-check

export const RELAY_BATCH_SIZE = 200;
export const RELAY_BUSY_INTERVAL_MS = 200;
export const RELAY_IDLE_INTERVAL_MS = 2_000;
/** The channel the outbox insert trigger notifies (migration 20261123100400). */
export const OUTBOX_CHANNEL = 'platform_outbox';

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
 * @property {() => void} start  Loops: every 200 ms while busy; when idle, on the next outbox
 *   NOTIFY or after 2 s, whichever comes first.
 * @property {() => Promise<void>} stop  Stops the loop after the current batch.
 */

/**
 * Creates the outbox relay. Rows are locked with `FOR UPDATE SKIP LOCKED`, so several relays
 * can run in parallel without publishing an event twice. Each event fans out to one queue per
 * subscribing module, with a job id that BullMQ deduplicates.
 *
 * With `listen` (the default), an idle relay wakes as soon as an outbox insert commits
 * (Postgres LISTEN on one extra connection) instead of waiting for its 2 s poll. The poll stays:
 * a lost notification (a reconnect, or a transaction pooler that drops LISTEN) only delays an
 * event by up to 2 s.
 * @param {{
 *   db: import('../db.js').Database,
 *   jobs: import('../jobs.js').JobRunner,
 *   subscriptions: ReadonlyMap<string, readonly string[]>,
 *   logger: import('pino').Logger,
 *   batchSize?: number,
 *   listen?: boolean,
 * }} options
 * @returns {Relay}
 */
export function createRelay({
  db,
  jobs,
  subscriptions,
  logger,
  batchSize = RELAY_BATCH_SIZE,
  listen = true,
}) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let running = false;
  /** A notification arrived during a batch: run the next one at once. */
  let notified = false;
  /** @type {Promise<{ unlisten: () => Promise<void> } | null>} */
  let listener = Promise.resolve(null);
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
    timer = null;
    notified = false;
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
        notified ? 0 : published > 0 ? RELAY_BUSY_INTERVAL_MS : RELAY_IDLE_INTERVAL_MS,
      );
    }
  };

  /** On NOTIFY: if the loop is waiting, run now; if a batch is running, run again after it. */
  const wake = () => {
    if (!running) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
      current = tick();
    } else {
      notified = true;
    }
  };

  return {
    relayOnce,
    start: () => {
      if (running) return;
      running = true;
      if (listen) {
        listener = db.sql.listen(OUTBOX_CHANNEL, wake).catch((err) => {
          logger.warn({ err }, 'outbox LISTEN failed; the relay polls every 2 s');
          return null;
        });
      }
      current = tick();
    },
    stop: async () => {
      running = false;
      if (timer) clearTimeout(timer);
      await current;
      const subscription = await listener;
      listener = Promise.resolve(null);
      await subscription?.unlisten().catch(() => {});
    },
  };
}
