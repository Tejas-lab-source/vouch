// @ts-check
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
