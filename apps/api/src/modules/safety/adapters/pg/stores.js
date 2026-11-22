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
      // Phase 10
      insert: async (ban) =>
        (
          await tx`INSERT INTO safety.bans (id, user_id, reason, created_by, created_at, expires_at)
            VALUES (${ban.id}, ${ban.userId}, ${ban.reason}, ${ban.createdBy}, ${ban.createdAt}, ${ban.expiresAt})
            ON CONFLICT DO NOTHING`
        ).count === 1,
      findForUpdate: async (id) =>
        /** @type {any} */ ((await tx`SELECT * FROM safety.bans WHERE id = ${id} FOR UPDATE`)[0]) ??
        null,
      activeFor: async (userId) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM safety.bans WHERE user_id = ${userId} AND lifted_at IS NULL`)[0]
        ) ?? null,
      lift: async (id, by, at) => {
        await tx`UPDATE safety.bans SET lifted_at = ${at}, lifted_by = ${by} WHERE id = ${id} AND lifted_at IS NULL`;
      },
      list: async ({ active, before, limit, now }) =>
        /** @type {any} */ (
          await tx`SELECT * FROM safety.bans
            WHERE (${active}::boolean IS FALSE OR (lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ${now})))
              AND (${before?.at ?? null}::timestamptz IS NULL OR (created_at, id) < (${before?.at ?? null}::timestamptz, ${before?.id ?? null}::uuid))
            ORDER BY created_at DESC, id DESC LIMIT ${limit}`
        ),
      expired: async (now, limit) =>
        /** @type {any} */ (
          await tx`SELECT id, user_id FROM safety.bans
            WHERE lifted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ${now}
            ORDER BY expires_at LIMIT ${limit}`
        ),
      purgeFinished: async (olderThan) =>
        (
          await tx`DELETE FROM safety.bans WHERE lifted_at < ${olderThan}
            OR (lifted_at IS NULL AND expires_at < ${olderThan})`
        ).count,
    },
    reports: {
      insert: async (r) => {
        await tx`INSERT INTO safety.reports (id, reporter_id, target_id, context, reason, evidence, created_at)
          VALUES (${r.id}, ${r.reporterId}, ${r.targetId}, ${r.context}, ${r.reason}, ${tx.json(r.evidence)}, ${r.createdAt})`;
      },
      find: async (id) =>
        /** @type {any} */ ((await tx`SELECT * FROM safety.reports WHERE id = ${id}`)[0]) ?? null,
      findForUpdate: async (id) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM safety.reports WHERE id = ${id} FOR UPDATE`)[0]
        ) ?? null,
      resolve: async (id, { status, resolution, by, note, at }) => {
        await tx`UPDATE safety.reports SET status = ${status}, resolution = ${resolution},
            resolved_by = ${by}, resolution_note = ${note}, closed_at = ${at}
          WHERE id = ${id} AND status = 'open'`;
      },
      list: async ({ status, after, limit }) =>
        /** @type {any} */ (
          await tx`SELECT id, reporter_id, target_id, context, reason, status, created_at, closed_at
            FROM safety.reports
            WHERE status = ${status}
              AND (${after?.at ?? null}::timestamptz IS NULL OR (created_at, id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
            ORDER BY created_at, id LIMIT ${limit}`
        ),
      distinctReportersSince: async (targetId, since, exclude) =>
        Number(
          (
            await tx`SELECT count(DISTINCT reporter_id)::int AS n FROM safety.reports
              WHERE target_id = ${targetId} AND created_at >= ${since} AND reporter_id <> ${exclude}`
          )[0]?.n ?? 0,
        ),
      countAgainst: async (targetId, exceptId) =>
        Number(
          (
            await tx`SELECT count(*)::int AS n FROM safety.reports
              WHERE target_id = ${targetId} AND id <> ${exceptId}`
          )[0]?.n ?? 0,
        ),
      openSystemReportFor: async (targetId, systemId) =>
        (
          await tx`SELECT 1 FROM safety.reports WHERE target_id = ${targetId}
            AND reporter_id = ${systemId} AND status = 'open' LIMIT 1`
        ).length === 1,
      purgeClosed: async (olderThan) =>
        (await tx`DELETE FROM safety.reports WHERE closed_at < ${olderThan}`).count,
    },
    verifications: {
      insert: async (v) =>
        (
          await tx`INSERT INTO safety.verification_reviews (id, user_id, id_image_key, selfie_image_key, submitted_at)
            VALUES (${v.id}, ${v.userId}, ${v.idImageKey}, ${v.selfieImageKey}, ${v.submittedAt})
            ON CONFLICT (id) DO NOTHING`
        ).count === 1,
      find: async (id) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM safety.verification_reviews WHERE id = ${id}`)[0]
        ) ?? null,
      findForUpdate: async (id) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM safety.verification_reviews WHERE id = ${id} FOR UPDATE`)[0]
        ) ?? null,
      pendingFor: async (userId) =>
        /** @type {any} */ (
          (
            await tx`SELECT * FROM safety.verification_reviews
              WHERE user_id = ${userId} AND status = 'pending'`
          )[0]
        ) ?? null,
      decide: async (id, { status, by, reason, at }) => {
        await tx`UPDATE safety.verification_reviews SET status = ${status}, decided_by = ${by},
            decision_reason = ${reason}, decided_at = ${at}
          WHERE id = ${id} AND status = 'pending'`;
      },
      list: async ({ status, after, limit }) =>
        /** @type {any} */ (
          await tx`SELECT * FROM safety.verification_reviews
            WHERE status = ${status}
              AND (${after?.at ?? null}::timestamptz IS NULL OR (submitted_at, id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
            ORDER BY submitted_at, id LIMIT ${limit}`
        ),
      imagesDecidedBefore: async (before, limit) =>
        /** @type {any} */ (
          await tx`SELECT id, id_image_key, selfie_image_key FROM safety.verification_reviews
            WHERE decided_at < ${before} AND (id_image_key IS NOT NULL OR selfie_image_key IS NOT NULL)
            ORDER BY decided_at LIMIT ${limit}`
        ),
      clearImages: async (ids) => {
        if (ids.length > 0) {
          await tx`UPDATE safety.verification_reviews SET id_image_key = NULL, selfie_image_key = NULL
            WHERE id = ANY(${ids})`;
        }
      },
    },
    rejections: {
      record: async (uploadId, userId, at) => {
        await tx`INSERT INTO safety.photo_rejections (upload_id, user_id, rejected_at)
          VALUES (${uploadId}, ${userId}, ${at}) ON CONFLICT DO NOTHING`;
      },
      countSince: async (userId, since) =>
        Number(
          (
            await tx`SELECT count(*)::int AS n FROM safety.photo_rejections
              WHERE user_id = ${userId} AND rejected_at >= ${since}`
          )[0]?.n ?? 0,
        ),
      purge: async (olderThan) =>
        (await tx`DELETE FROM safety.photo_rejections WHERE rejected_at < ${olderThan}`).count,
    },
    erasure: {
      /** Everything of a deleted user except reports (moderation records) and active bans. */
      eraseUser: async (userId) => {
        const images = /** @type {any} */ (
          await tx`DELETE FROM safety.verification_reviews WHERE user_id = ${userId}
            RETURNING id_image_key, selfie_image_key`
        );
        const others = (
          await tx`DELETE FROM safety.blocks WHERE blocker_id = ${userId} OR blocked_id = ${userId}
            RETURNING CASE WHEN blocker_id = ${userId} THEN blocked_id ELSE blocker_id END AS other_id`
        ).map((r) => /** @type {string} */ (r.otherId));
        await tx`DELETE FROM safety.photo_rejections WHERE user_id = ${userId}`;
        return {
          others,
          imageKeys: images.flatMap((/** @type {any} */ r) =>
            [r.idImageKey, r.selfieImageKey].filter(Boolean),
          ),
        };
      },
    },
  };
}
