// @ts-check
import postgres from 'postgres';

/**
 * Modules that own a Postgres role (`vouch_<module>`), plus `discovery` (views only).
 * Kept explicit so a typo cannot produce an arbitrary `SET ROLE`.
 */
export const DB_MODULES = Object.freeze([
  'platform',
  'identity',
  'profiles',
  'media',
  'safety',
  'discovery',
  'matching',
  'chat',
  'notifications',
  'admin',
]);

const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;

/**
 * @typedef {object} DatabaseOptions
 * @property {string} url  One login per environment, granted membership in every module role.
 * @property {number} [max]
 * @property {boolean} [prepare]  false behind a transaction pooler.
 * @property {number} [statementTimeoutMs]  Applied to every module transaction.
 * @property {readonly string[]} [extraModules]  Additional module roles (tests only).
 * @property {string} [replicaUrl]  A read replica; `read(..., { replica: true })` uses it.
 */

/**
 * @typedef {object} Database
 * @property {import('postgres').Sql} sql  Raw client. Module code never uses it directly.
 * @property {<T>(module: string, fn: (tx: import('postgres').TransactionSql) => Promise<T>) => Promise<T>} transaction
 *   Runs `fn` in a read-write transaction as `vouch_<module>`.
 * @property {<T>(module: string, fn: (tx: import('postgres').TransactionSql) => Promise<T>, options?: { replica?: boolean }) => Promise<T>} read
 *   Runs `fn` in a read-only transaction as `vouch_<module>`. With `{ replica: true }` it runs
 *   on the read replica when one is configured, and on the primary otherwise. Replica reads can
 *   lag, so only paths that tolerate slightly stale data use them (the deck builder).
 * @property {() => Promise<void>} end  Closes the pool, waiting up to 5 s for queries.
 */

/**
 * Creates the database access layer (ADR 0010). There is one pool. Every module query runs
 * inside a transaction that starts with `SET LOCAL ROLE vouch_<module>`, so it has exactly that
 * module's privileges and the role ends with the transaction. This works behind hosted
 * transaction poolers, which ignore per-connection startup options.
 * @param {DatabaseOptions} options
 * @returns {Database}
 */
export function createDatabase({
  url,
  max = 10,
  prepare = true,
  statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS,
  extraModules = [],
  replicaUrl,
}) {
  /** @param {string} target @param {string} name */
  const pool = (target, name) =>
    postgres(target, {
      max,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare,
      transform: postgres.camel,
      onnotice: () => {},
      connection: { application_name: name },
    });
  const sql = pool(url, 'vouch-api');
  const replica = replicaUrl ? pool(replicaUrl, 'vouch-api-replica') : sql;
  const allowed = new Set([...DB_MODULES, ...extraModules]);

  /**
   * @param {string} module
   * @param {boolean} readOnly
   */
  const preamble = (module, readOnly) => {
    if (!allowed.has(module) || !/^[a-z]+$/.test(module)) {
      throw new Error(`unknown database module: ${module}`);
    }
    const timeout = Math.trunc(statementTimeoutMs);
    return [
      readOnly ? 'SET TRANSACTION READ ONLY' : null,
      `SET LOCAL ROLE vouch_${module}`,
      `SET LOCAL statement_timeout = ${timeout}`,
    ]
      .filter(Boolean)
      .join('; ');
  };

  /**
   * @template T
   * @param {string} module
   * @param {boolean} readOnly
   * @param {(tx: import('postgres').TransactionSql) => Promise<T>} fn
   * @param {import('postgres').Sql} [client]
   * @returns {Promise<T>}
   */
  const run = async (module, readOnly, fn, client = sql) => {
    const statements = preamble(module, readOnly);
    return /** @type {Promise<T>} */ (
      client.begin(async (tx) => {
        await tx.unsafe(statements);
        return fn(tx);
      })
    );
  };

  return {
    sql,
    transaction: (module, fn) => run(module, false, fn),
    read: (module, fn, options = {}) => run(module, true, fn, options.replica ? replica : sql),
    end: async () => {
      await Promise.all([
        sql.end({ timeout: 5 }),
        replica === sql ? null : replica.end({ timeout: 5 }),
      ]);
    },
  };
}
