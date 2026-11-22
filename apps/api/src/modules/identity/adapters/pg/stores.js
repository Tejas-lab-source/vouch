// @ts-check

/**
 * Postgres implementation of the identity stores, bound to one transaction running as
 * `vouch_identity`. Column names come back camelCased (platform transform).
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').IdentityStores & { retention: ReturnType<typeof retentionQueries> }}
 */
export function createIdentityStores(tx) {
  /** @param {any} row */
  const user = (row) => row && { ...row, birthDate: toDate(row.birthDate) };
  return {
    users: {
      findByEmailHmac: async (emailHmac) =>
        user((await tx`SELECT * FROM identity.users WHERE email_hmac = ${emailHmac}`)[0]) ?? null,
      findById: async (id) =>
        user((await tx`SELECT * FROM identity.users WHERE id = ${id}`)[0]) ?? null,
      findManyByIds: async (ids) =>
        ids.length === 0
          ? []
          : (await tx`SELECT * FROM identity.users WHERE id = ANY(${ids})`).map(user),
      findManyByPublicIds: async (publicIds) =>
        publicIds.length === 0
          ? []
          : (await tx`SELECT * FROM identity.users WHERE public_id = ANY(${publicIds})`).map(user),
      insert: async (u) => {
        await tx`INSERT INTO identity.users (id, public_id, college_id, email_hmac, status, birth_date, grad_year, created_at, updated_at)
          VALUES (${u.id}, ${u.publicId}, ${u.collegeId}, ${u.emailHmac}, ${u.status}, ${u.birthDate}, ${u.gradYear}, ${u.createdAt}, ${u.createdAt})`;
      },
      deletedBefore: async (cutoff, limit) =>
        (
          await tx`SELECT * FROM identity.users WHERE status = 'deleted' AND deleted_at < ${cutoff}
            ORDER BY deleted_at LIMIT ${limit}`
        ).map(user),
      markDeleted: async (id, at) => {
        await tx`UPDATE identity.users SET status = 'deleted', deleted_at = ${at}, updated_at = ${at} WHERE id = ${id}`;
      },
      setStatus: async (id, status) => {
        await tx`UPDATE identity.users SET status = ${status}, updated_at = now() WHERE id = ${id}`;
      },
    },
    sessions: {
      insert: async (s) => {
        await tx`INSERT INTO identity.auth_sessions (id, user_id, device_id, family_id, token_hash, created_at, expires_at)
          VALUES (${s.id}, ${s.userId}, ${s.deviceId}, ${s.familyId}, ${s.tokenHash}, ${s.createdAt}, ${s.expiresAt})`;
      },
      findByTokenHashForUpdate: async (tokenHash) =>
        /** @type {any} */ (
          (
            await tx`SELECT * FROM identity.auth_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`
          )[0]
        ) ?? null,
      findById: async (id) =>
        /** @type {any} */ ((await tx`SELECT * FROM identity.auth_sessions WHERE id = ${id}`)[0]) ??
        null,
      findByIdForUpdate: async (id) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM identity.auth_sessions WHERE id = ${id} FOR UPDATE`)[0]
        ) ?? null,
      markRotated: async (id, replacedBy, at) => {
        await tx`UPDATE identity.auth_sessions SET replaced_by = ${replacedBy}, revoked_at = ${at} WHERE id = ${id}`;
      },
      revokeFamily: async (familyId, at) =>
        (
          await tx`UPDATE identity.auth_sessions SET revoked_at = ${at} WHERE family_id = ${familyId} AND revoked_at IS NULL`
        ).count,
      revokeAllForUser: async (userId, at) =>
        (
          await tx`UPDATE identity.auth_sessions SET revoked_at = ${at} WHERE user_id = ${userId} AND revoked_at IS NULL`
        ).count,
      revokeAllForDevice: async (deviceId, at) =>
        (
          await tx`UPDATE identity.auth_sessions SET revoked_at = ${at} WHERE device_id = ${deviceId} AND revoked_at IS NULL`
        ).count,
    },
    devices: {
      insert: async (d) => {
        await tx`INSERT INTO identity.devices (id, user_id, platform, app_version, created_at, last_seen_at)
          VALUES (${d.id}, ${d.userId}, ${d.platform}, ${d.appVersion}, ${d.at}, ${d.at})`;
      },
      listActive: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT * FROM identity.devices WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 50`
        ),
      findForUser: async (id, userId) =>
        /** @type {any} */ (
          (await tx`SELECT * FROM identity.devices WHERE id = ${id} AND user_id = ${userId}`)[0]
        ) ?? null,
      revoke: async (id, at) => {
        await tx`UPDATE identity.devices SET revoked_at = ${at}, push_token = NULL WHERE id = ${id}`;
      },
      setPushToken: async (id, pushToken, platform, at) => {
        // A push token belongs to one device: clear it anywhere else first.
        await tx`UPDATE identity.devices SET push_token = NULL WHERE push_token = ${pushToken} AND id <> ${id}`;
        await tx`UPDATE identity.devices SET push_token = ${pushToken}, platform = ${platform}, last_seen_at = ${at} WHERE id = ${id}`;
      },
      touch: async (id, at) => {
        await tx`UPDATE identity.devices SET last_seen_at = ${at} WHERE id = ${id}`;
      },
      pushTokensOf: async (userId) =>
        (
          await tx`SELECT push_token FROM identity.devices
            WHERE user_id = ${userId} AND revoked_at IS NULL AND push_token IS NOT NULL
            ORDER BY last_seen_at DESC LIMIT 10`
        ).map((r) => /** @type {string} */ (r.pushToken)),
      clearPushToken: async (pushToken) =>
        (await tx`UPDATE identity.devices SET push_token = NULL WHERE push_token = ${pushToken}`)
          .count,
    },
    bannedEmails: {
      insert: async ({ banId, emailHmac, expiresAt }) => {
        await tx`INSERT INTO identity.banned_emails (ban_id, email_hmac, expires_at)
          VALUES (${banId}, ${emailHmac}, ${expiresAt}) ON CONFLICT (ban_id) DO NOTHING`;
      },
      removeByBan: async (banId) => {
        await tx`DELETE FROM identity.banned_emails WHERE ban_id = ${banId}`;
      },
      isBanned: async (emailHmac, now) =>
        (
          await tx`SELECT 1 FROM identity.banned_emails WHERE email_hmac = ${emailHmac}
            AND (expires_at IS NULL OR expires_at > ${now}) LIMIT 1`
        ).length > 0,
    },
    consents: {
      insert: async (c) => {
        await tx`INSERT INTO identity.consents (id, user_id, notice_version, purposes, granted_at)
          VALUES (${c.id}, ${c.userId}, ${c.noticeVersion}, ${c.purposes}, ${c.at})`;
      },
      listForUser: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT notice_version, purposes, granted_at, withdrawn_at FROM identity.consents WHERE user_id = ${userId} ORDER BY granted_at`
        ),
    },
    retention: retentionQueries(tx),
  };
}

/**
 * Retention deletes (docs/data-model.md, Retention).
 * @param {import('postgres').TransactionSql} tx
 */
function retentionQueries(tx) {
  return {
    /** Sessions that expired or were revoked before the cutoff. @param {Date} olderThan */
    purgeSessions: async (olderThan) =>
      (
        await tx`DELETE FROM identity.auth_sessions WHERE expires_at < ${olderThan} OR revoked_at < ${olderThan}`
      ).count,
    /** Ban records of bans that expired before the cutoff. @param {Date} olderThan */
    purgeExpiredBannedEmails: async (olderThan) =>
      (await tx`DELETE FROM identity.banned_emails WHERE expires_at <= ${olderThan}`).count,
    /** Devices revoked before the cutoff. @param {Date} olderThan */
    purgeDevices: async (olderThan) =>
      (await tx`DELETE FROM identity.devices WHERE revoked_at < ${olderThan}`).count,
    /** Accounts deleted before the cutoff (erasure). Cascades to sessions, devices, consents. @param {Date} olderThan */
    purgeDeletedUsers: async (olderThan) =>
      (await tx`DELETE FROM identity.users WHERE deleted_at < ${olderThan}`).count,
  };
}

/**
 * `date` columns come back as Date at midnight UTC; the domain uses `YYYY-MM-DD`.
 * @param {unknown} value
 */
function toDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}
