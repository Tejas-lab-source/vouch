// @ts-check

/**
 * Postgres stores of admin (role `vouch_admin`), bound to one transaction.
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').AdminStores}
 */
export function createAdminStores(tx) {
  return {
    staff: {
      findByEmailHmac: async (emailHmac) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM admin.admin_users WHERE email_hmac = ${emailHmac}`)[0]
        ) ?? null,
      findById: async (id) =>
        /** @type {any} */ ((await tx`SELECT * FROM admin.admin_users WHERE id = ${id}`)[0]) ??
        null,
      insert: async (a) => {
        await tx`INSERT INTO admin.admin_users (id, email_hmac, display_name, role, password_hash,
            totp_secret_enc, mfa_enabled_at)
          VALUES (${a.id}, ${a.emailHmac}, ${a.displayName}, ${a.role}, ${a.passwordHash},
            ${a.totpSecretEnc}, ${a.mfaEnabledAt})`;
      },
      /** Records a TOTP step; false when that step (or a later one) was already used. */
      useTotpStep: async (id, step, at) =>
        (
          await tx`UPDATE admin.admin_users SET last_totp_step = ${step}, last_login_at = ${at}
            WHERE id = ${id} AND last_totp_step < ${step}`
        ).count === 1,
      namesOf: async (ids) =>
        ids.length === 0
          ? new Map()
          : new Map(
              (await tx`SELECT id, display_name FROM admin.admin_users WHERE id = ANY(${ids})`).map(
                (r) => [/** @type {string} */ (r.id), /** @type {string} */ (r.displayName)],
              ),
            ),
    },
    audit: {
      insert: async (e) => {
        await tx`INSERT INTO admin.audit_log (id, actor_id, action, target_type, target_id, details, request_id, created_at)
          VALUES (${e.id}, ${e.actorId}, ${e.action}, ${e.targetType}, ${e.targetId},
            ${tx.json(e.details)}, ${e.requestId}, ${e.createdAt})`;
      },
      list: async ({ before, limit, targetType, targetId }) =>
        /** @type {any} */ (
          await tx`SELECT * FROM admin.audit_log
            WHERE (${targetType ?? null}::text IS NULL OR target_type = ${targetType ?? null})
              AND (${targetId ?? null}::text IS NULL OR target_id = ${targetId ?? null})
              AND (${before?.at ?? null}::timestamptz IS NULL
                OR (created_at, id) < (${before?.at ?? null}::timestamptz, ${before?.id ?? null}::uuid))
            ORDER BY created_at DESC, id DESC LIMIT ${limit}`
        ),
      purge: async (olderThan) =>
        (await tx`DELETE FROM admin.audit_log WHERE created_at < ${olderThan}`).count,
    },
    flags: {
      list: async () =>
        /** @type {any} */ (
          await tx`SELECT key, enabled, rules, updated_at FROM platform.feature_flags ORDER BY key`
        ),
      put: async (key, enabled, rules, at) =>
        /** @type {any} */ (
          (
            await tx`INSERT INTO platform.feature_flags (key, enabled, rules, updated_at)
              VALUES (${key}, ${enabled}, ${tx.json(rules)}, ${at})
              ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, rules = EXCLUDED.rules,
                updated_at = EXCLUDED.updated_at
              RETURNING key, enabled, rules, updated_at`
          )[0]
        ),
    },
    platform: {
      collegeName: async (collegeId) =>
        /** @type {string | null} */ (
          (await tx`SELECT name FROM platform.colleges_v WHERE id = ${collegeId}`)[0]?.name ?? null
        ),
      completedDeletions: async (userIds) =>
        userIds.length === 0
          ? []
          : /** @type {any} */ (
              await tx`SELECT user_id, module FROM platform.deletion_tasks
                WHERE user_id = ANY(${userIds}) AND completed_at IS NOT NULL`
            ),
    },
  };
}
