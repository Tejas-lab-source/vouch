// @ts-check
import { adminActionRecorded } from '@vouch/contracts';
import { getContext } from './context.js';
import { insertOutbox } from './events/outbox.js';

/**
 * @template Stores
 * @typedef {object} UnitOfWorkScope
 * @property {import('postgres').TransactionSql} tx
 * @property {Stores} stores  The module's stores, bound to this transaction.
 * @property {(event: import('@vouch/contracts').EventDefinition, payload: unknown) => Promise<number>} emit
 *   Writes an event to the outbox in this transaction.
 */

/**
 * @template Stores
 * @typedef {object} UnitOfWork
 * @property {<T>(fn: (scope: UnitOfWorkScope<Stores>) => Promise<T>) => Promise<T>} run
 */

/**
 * Creates a module's unit of work. `run(fn)` opens a transaction as the module's role, binds the
 * module's stores to it, and lets `fn` emit events into the same transaction: either the change
 * and its events commit together, or neither does.
 * @template Stores
 * @param {{
 *   db: import('./db.js').Database,
 *   module: string,
 *   stores?: (tx: import('postgres').TransactionSql) => Stores,
 * }} options
 * @returns {UnitOfWork<Stores>}
 */
export function createUnitOfWork({ db, module, stores = () => /** @type {Stores} */ ({}) }) {
  return {
    run: (fn) =>
      db.transaction(module, (tx) =>
        fn({
          tx,
          stores: stores(tx),
          emit: (event, payload) => insertOutbox(tx, event, payload, getContext().traceId ?? null),
        }),
      ),
  };
}

// --- Staff audit trail (ADR 0025) ------------------------------------------------------

/**
 * @typedef {{ action: string, targetType: string, targetId: string, details?: Record<string, unknown> }} AuditFacts
 * @typedef {object} AuditTrail  Who is acting, passed from the admin module into the module
 *   that makes the change. That module records each change in the same transaction (ADR 0025).
 * @property {(facts: AuditFacts) => import('zod').infer<typeof adminActionRecorded.payload>} entry
 */

/**
 * The trail of one staff request.
 * @param {{ actorId: string, requestId: string | null, newId: () => string, now: () => Date }} input
 * @returns {AuditTrail}
 */
export function createAuditTrail({ actorId, requestId, newId, now }) {
  return {
    entry: ({ action, targetType, targetId, details = {} }) => ({
      auditId: newId(),
      actorId,
      action,
      targetType,
      targetId: String(targetId),
      details,
      requestId,
      occurredAt: now().toISOString(),
    }),
  };
}

/**
 * Records one staff change through the outbox of the transaction that makes it, so the change
 * and its audit entry commit together. A no-op when the change is not made by staff.
 * @param {(event: any, payload: unknown) => Promise<unknown>} emit  The transaction's `emit`.
 * @param {AuditTrail | null | undefined} trail
 * @param {AuditFacts} facts
 */
export async function recordAudit(emit, trail, facts) {
  if (trail) await emit(adminActionRecorded, trail.entry(facts));
}
