// @ts-check
import { PARTITIONS } from '../../application/retention.js';

/**
 * Postgres stores of matching (role `vouch_matching`), bound to one transaction.
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').MatchingStores}
 */
export function createMatchingStores(tx) {
  const MATCH = tx`id, user_low, user_high, created_at, unmatched_at, anonymised_at`;
  /** @param {any[]} rows */
  const first = (rows) => rows[0] ?? null;

  return {
    swipes: {
      insertLike: async (swiperId, targetId, at) =>
        (
          await tx`INSERT INTO matching.swipes (swiper_id, target_id, direction, created_at)
            VALUES (${swiperId}, ${targetId}, 1, ${at}) ON CONFLICT DO NOTHING`
        ).count === 1,
      likes: async (swiperId, targetId) =>
        (
          await tx`SELECT 1 FROM matching.swipes
            WHERE swiper_id = ${swiperId} AND target_id = ${targetId} AND direction = 1`
        ).length === 1,
      // One statement per batch. Passes by or for accounts that are no longer active are
      // dropped (a deleted user's buffered passes must not come back).
      insertPasses: async (passes) =>
        (
          await tx`INSERT INTO matching.swipes (swiper_id, target_id, direction, created_at)
            SELECT p.swiper, p.target, 0, p.at
            FROM unnest(${passes.map((p) => p.swiperId)}::uuid[],
                        ${passes.map((p) => p.targetId)}::uuid[],
                        ${passes.map((p) => p.swipedAt)}::timestamptz[]) AS p(swiper, target, at)
            JOIN identity.active_users_v a ON a.id = p.swiper
            JOIN identity.active_users_v b ON b.id = p.target
            WHERE p.swiper <> p.target
            ON CONFLICT DO NOTHING`
        ).count,
      likesInCount: async (userId) =>
        Number(
          (
            await tx`SELECT count(*)::int AS n FROM matching.swipes l
              WHERE l.target_id = ${userId} AND l.direction = 1
                AND NOT EXISTS (SELECT 1 FROM matching.swipes s
                  WHERE s.swiper_id = ${userId} AND s.target_id = l.swiper_id)
                AND NOT EXISTS (SELECT 1 FROM safety.block_pairs_v b
                  WHERE b.user_id = ${userId} AND b.other_id = l.swiper_id)`
          )[0]?.n ?? 0,
        ),
      forUser: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT target_id, direction, created_at FROM matching.swipes
            WHERE swiper_id = ${userId} ORDER BY created_at`
        ),
      removeForUser: async (userId) =>
        (await tx`DELETE FROM matching.swipes WHERE swiper_id = ${userId} OR target_id = ${userId}`)
          .count,
      purgePasses: async (partition, olderThan, limit) => {
        if (!Number.isInteger(partition) || partition < 0 || partition >= PARTITIONS) {
          throw new Error(`invalid swipes partition ${partition}`);
        }
        const table = tx(`swipes_p${partition}`);
        return (
          await tx`DELETE FROM matching.${table} WHERE ctid IN (
              SELECT ctid FROM matching.${table}
              WHERE direction = 0 AND created_at < ${olderThan} LIMIT ${limit})`
        ).count;
      },
    },
    matches: {
      createOrGet: async ({ id, userLow, userHigh, at }) => {
        const inserted = first(
          await tx`INSERT INTO matching.matches (id, user_low, user_high, created_at)
            VALUES (${id}, ${userLow}, ${userHigh}, ${at})
            ON CONFLICT (user_low, user_high) DO NOTHING RETURNING ${MATCH}`,
        );
        if (inserted) return { match: inserted, created: true };
        return {
          match: first(
            await tx`SELECT ${MATCH} FROM matching.matches
              WHERE user_low = ${userLow} AND user_high = ${userHigh}`,
          ),
          created: false,
        };
      },
      findPair: async (userLow, userHigh) =>
        first(
          await tx`SELECT ${MATCH} FROM matching.matches
            WHERE user_low = ${userLow} AND user_high = ${userHigh}`,
        ),
      find: async (id) => first(await tx`SELECT ${MATCH} FROM matching.matches WHERE id = ${id}`),
      findForUpdate: async (id) =>
        first(await tx`SELECT ${MATCH} FROM matching.matches WHERE id = ${id} FOR UPDATE`),
      setUnmatched: async (id, at) => {
        await tx`UPDATE matching.matches SET unmatched_at = ${at}
          WHERE id = ${id} AND unmatched_at IS NULL`;
      },
      activeForUser: async (userId, after, limit) =>
        /** @type {any} */ (
          await tx`SELECT ${MATCH} FROM matching.matches
            WHERE (user_low = ${userId} OR user_high = ${userId})
              AND unmatched_at IS NULL AND anonymised_at IS NULL
              ${after ? tx`AND (created_at, id) < (${after.createdAt}, ${after.id})` : tx``}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit}`
        ),
      allForUser: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT ${MATCH} FROM matching.matches
            WHERE user_low = ${userId} OR user_high = ${userId} ORDER BY created_at`
        ),
      anonymise: async (id, userLow, userHigh, at) => {
        await tx`UPDATE matching.matches
          SET user_low = ${userLow}, user_high = ${userHigh},
              anonymised_at = coalesce(anonymised_at, ${at})
          WHERE id = ${id}`;
      },
    },
  };
}
