// @ts-check

/**
 * Postgres stores of safety (role `vouch_safety`), bound to one transaction.
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').SafetyStores}
 */
export function createSafetyStores(tx) {
  return {
    blocks: {
      insert: async (blockerId, blockedId, at) =>
        (
          await tx`INSERT INTO safety.blocks (blocker_id, blocked_id, created_at)
            VALUES (${blockerId}, ${blockedId}, ${at}) ON CONFLICT DO NOTHING`
        ).count === 1,
      remove: async (blockerId, blockedId) =>
        (
          await tx`DELETE FROM safety.blocks WHERE blocker_id = ${blockerId} AND blocked_id = ${blockedId}`
        ).count === 1,
      blockedBy: async (blockerId) =>
        /** @type {any} */ (
          await tx`SELECT blocked_id, created_at FROM safety.blocks
            WHERE blocker_id = ${blockerId} ORDER BY created_at DESC`
        ),
      othersOf: async (userId) =>
        (await tx`SELECT other_id FROM safety.block_pairs_v WHERE user_id = ${userId}`).map(
          (row) => /** @type {string} */ (row.otherId),
        ),
      blockersBetween: async (a, b) =>
        (
          await tx`SELECT blocker_id FROM safety.blocks
            WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a})`
        ).map((row) => /** @type {string} */ (row.blockerId)),
      exists: async (a, b) =>
        (
          await tx`SELECT 1 FROM safety.block_pairs_v WHERE user_id = ${a} AND other_id = ${b} LIMIT 1`
        ).length === 1,
    },
    bans: {
      activeAmong: async (userIds, now) =>
        (
          await tx`SELECT user_id FROM safety.bans
            WHERE user_id = ANY(${userIds}) AND lifted_at IS NULL
              AND (expires_at IS NULL OR expires_at > ${now})`
        ).map((row) => /** @type {string} */ (row.userId)),
    },
  };
}
