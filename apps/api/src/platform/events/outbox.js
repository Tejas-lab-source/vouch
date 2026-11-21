// @ts-check
import { AppError } from '../errors.js';

/**
 * Writes one domain event to `platform.outbox` inside the caller's transaction. The payload is
 * validated against the event's contract first, so a malformed event never leaves the module.
 * @param {import('postgres').TransactionSql} tx
 * @param {import('@vouch/contracts').EventDefinition} event
 * @param {unknown} payload
 * @param {string | null} traceId
 * @returns {Promise<number>} The outbox id (the event id consumers deduplicate on).
 */
export async function insertOutbox(tx, event, payload, traceId) {
  const parsed = event.payload.safeParse(payload);
  if (!parsed.success) {
    throw new AppError('INTERNAL', {
      message: `invalid payload for ${event.name}`,
      cause: parsed.error,
    });
  }
  const [row] = await tx`
    INSERT INTO platform.outbox (name, version, payload, trace_id)
    VALUES (${event.name}, ${event.version}, ${tx.json(/** @type {any} */ (parsed.data))}, ${traceId})
    RETURNING id`;
  return Number(row.id);
}
