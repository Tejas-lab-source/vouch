// @ts-check

/**
 * Takes a transaction-level advisory lock for an unordered pair of ids. Both orders of the
 * same pair take the same lock. Transaction-level locks are released on commit or rollback,
 * so they are safe behind transaction poolers (session locks are not).
 * @param {import('postgres').TransactionSql} tx
 * @param {string} a
 * @param {string} b
 * @returns {Promise<void>}
 */
export async function lockPair(tx, a, b) {
  const [low, high] = a < b ? [a, b] : [b, a];
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${low}|${high}`}, 0))`;
}

/**
 * Takes a transaction-level advisory lock for one key, for example `media:uploads:<userId>`,
 * to serialise check-then-insert sequences such as a per-user limit.
 * @param {import('postgres').TransactionSql} tx
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function lockKey(tx, key) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
