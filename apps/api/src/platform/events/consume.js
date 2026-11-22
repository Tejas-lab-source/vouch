// @ts-check
import { runWithContext } from '../context.js';
import { insertOutbox } from './outbox.js';

/**
 * @typedef {object} EventContext
 * @property {import('postgres').TransactionSql} tx  The consumer module's transaction.
 * @property {string | null} traceId
 * @property {number} eventId
 * @property {(event: import('@vouch/contracts').EventDefinition, payload: unknown) => Promise<number>} emit
 *   Writes an event to the outbox in the same transaction (consumers that produce events).
 * @property {(fn: () => Promise<unknown> | unknown) => void} afterCommit
 *   Runs `fn` once the transaction has committed, for side effects that must not see
 *   uncommitted state (cache invalidation). Failures are ignored: such effects are best-effort.
 */

/**
 * @typedef {(event: any, context: EventContext) => Promise<void>} EventHandler
 */

/**
 * Wraps an event handler as a job processor. The envelope is validated against the event
 * contract, and the inbox insert and the handler run in one transaction as the consumer's role:
 * a redelivered event finds its inbox row and is a no-op.
 * @param {{
 *   db: import('../db.js').Database,
 *   consumer: string,
 *   event: import('@vouch/contracts').EventDefinition,
 *   handler: EventHandler,
 * }} options
 * @returns {(job: { data: unknown }) => Promise<'processed' | 'duplicate'>}
 */
export function createConsumer({ db, consumer, event, handler }) {
  return async (job) => {
    const envelope = /** @type {{ id: number, traceId: string | null, payload: any }} */ (
      event.envelope.parse(job.data)
    );
    /** @type {(() => Promise<unknown> | unknown)[]} */
    const afterCommit = [];
    return runWithContext({ traceId: envelope.traceId, module: consumer }, async () => {
      const outcome = await db.transaction(consumer, async (tx) => {
        const [fresh] = await tx`
          INSERT INTO platform.inbox (consumer, event_id)
          VALUES (${consumer}, ${envelope.id})
          ON CONFLICT DO NOTHING
          RETURNING 1 AS inserted`;
        if (!fresh) return /** @type {const} */ ('duplicate');
        await handler(envelope.payload, {
          tx,
          traceId: envelope.traceId,
          eventId: envelope.id,
          emit: (definition, payload) => insertOutbox(tx, definition, payload, envelope.traceId),
          afterCommit: (fn) => void afterCommit.push(fn),
        });
        return /** @type {const} */ ('processed');
      });
      await Promise.allSettled(afterCommit.map(async (fn) => fn()));
      return outcome;
    });
  };
}
