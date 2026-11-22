// @ts-check

/**
 * Postgres stores of the profiles module, bound to one transaction (role `vouch_profiles`).
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').ProfilesStores}
 */
export function createProfilesStores(tx) {
  const PROFILE = tx`user_id, college_id, cluster_id, name, gender, interested_in, bio,
    birth_date::text AS birth_date, min_age, max_age, status, created_at, updated_at`;
  const PHOTO = tx`id, user_id, upload_id, status, position, key_1080, key_400, created_at`;
  /** @param {any[]} rows */
  const first = (rows) => rows[0] ?? null;

  return {
    profiles: {
      insertIfMissing: async (p) =>
        (
          await tx`INSERT INTO profiles.profiles (user_id, college_id, cluster_id, birth_date, created_at, updated_at)
            VALUES (${p.userId}, ${p.collegeId}, ${p.clusterId}, ${p.birthDate}, ${p.at}, ${p.at})
            ON CONFLICT (user_id) DO NOTHING`
        ).count === 1,
      find: async (userId) =>
        first(await tx`SELECT ${PROFILE} FROM profiles.profiles WHERE user_id = ${userId}`),
      findForUpdate: async (userId) =>
        first(
          await tx`SELECT ${PROFILE} FROM profiles.profiles WHERE user_id = ${userId} FOR UPDATE`,
        ),
      update: async (userId, fields, at) => {
        await tx`UPDATE profiles.profiles SET
            name = ${fields.name}, gender = ${fields.gender}, interested_in = ${fields.interestedIn},
            bio = ${fields.bio}, min_age = ${fields.minAge}, max_age = ${fields.maxAge},
            status = ${fields.status}, updated_at = ${at}
          WHERE user_id = ${userId}`;
      },
      findActiveMany: async (ids) =>
        ids.length === 0
          ? []
          : /** @type {any} */ (
              await tx`SELECT ${PROFILE} FROM profiles.profiles WHERE user_id = ANY(${ids}) AND status = 'active'`
            ),
      remove: async (userId) =>
        (await tx`DELETE FROM profiles.profiles WHERE user_id = ${userId}`).count,
    },
    photos: {
      listForUser: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT ${PHOTO} FROM profiles.photos WHERE user_id = ${userId} ORDER BY position, created_at`
        ),
      findForUpdate: async (id) =>
        first(await tx`SELECT ${PHOTO} FROM profiles.photos WHERE id = ${id} FOR UPDATE`),
      insert: async (p) => {
        await tx`INSERT INTO profiles.photos (id, user_id, upload_id, status, position, key_1080, key_400, created_at, updated_at)
          VALUES (${p.id}, ${p.userId}, ${p.id}, ${p.status}, ${p.position}, ${p.key1080}, ${p.key400}, ${p.at}, ${p.at})
          ON CONFLICT (id) DO NOTHING`;
      },
      setStatus: async (id, status, keys, at) => {
        await tx`UPDATE profiles.photos SET status = ${status}, key_1080 = ${keys?.w1080 ?? null},
            key_400 = ${keys?.w400 ?? null}, updated_at = ${at}
          WHERE id = ${id}`;
      },
      approvedForUsers: async (ids) =>
        ids.length === 0
          ? []
          : /** @type {any} */ (
              await tx`SELECT ${PHOTO} FROM profiles.photos
                WHERE user_id = ANY(${ids}) AND status = 'approved' ORDER BY position, created_at`
            ),
    },
    sections: {
      listForUser: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT user_id, type, schema_version, data, position FROM profiles.profile_sections
            WHERE user_id = ${userId} ORDER BY position, type`
        ),
      listForUsers: async (ids) =>
        ids.length === 0
          ? []
          : /** @type {any} */ (
              await tx`SELECT user_id, type, schema_version, data, position FROM profiles.profile_sections
                WHERE user_id = ANY(${ids}) ORDER BY position, type`
            ),
      upsert: async (s) => {
        await tx`INSERT INTO profiles.profile_sections (user_id, type, schema_version, data, position, updated_at)
          VALUES (${s.userId}, ${s.type}, ${s.schemaVersion}, ${tx.json(/** @type {any} */ (s.data))}, ${s.position}, ${s.at})
          ON CONFLICT (user_id, type) DO UPDATE SET schema_version = EXCLUDED.schema_version,
            data = EXCLUDED.data, position = EXCLUDED.position, updated_at = EXCLUDED.updated_at`;
      },
    },
    colleges: {
      byIds: async (ids) =>
        ids.length === 0
          ? []
          : /** @type {any} */ (
              await tx`SELECT id, name, cluster_id FROM platform.colleges_v WHERE id = ANY(${ids})`
            ),
    },
  };
}
