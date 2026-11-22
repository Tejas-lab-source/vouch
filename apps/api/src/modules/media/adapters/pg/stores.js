// @ts-check

/**
 * Postgres stores of the media module, bound to one transaction (role `vouch_media`).
 * @param {import('postgres').TransactionSql} tx
 * @returns {import('../../ports.js').MediaStores}
 */
export function createMediaStores(tx) {
  const COLUMNS = tx`id, user_id, raw_key, content_type, max_bytes, status, photo_key, error_code, created_at`;
  return {
    uploads: {
      insert: async (u) => {
        await tx`INSERT INTO media.uploads (id, user_id, raw_key, content_type, max_bytes, status, created_at)
          VALUES (${u.id}, ${u.userId}, ${u.rawKey}, ${u.contentType}, ${u.maxBytes}, 'pending', ${u.createdAt})`;
      },
      findForUser: async (id, userId) =>
        /** @type {any} */ (
          (
            await tx`SELECT ${COLUMNS} FROM media.uploads WHERE id = ${id} AND user_id = ${userId}`
          )[0]
        ) ?? null,
      findForUpdate: async (id) =>
        /** @type {any} */ (
          (await tx`SELECT ${COLUMNS} FROM media.uploads WHERE id = ${id} FOR UPDATE`)[0]
        ) ?? null,
      listForUser: async (userId) =>
        /** @type {any} */ (
          await tx`SELECT ${COLUMNS} FROM media.uploads WHERE user_id = ${userId} ORDER BY created_at`
        ),
      markUploaded: async (id, at) => {
        await tx`UPDATE media.uploads SET status = 'uploaded', confirmed_at = ${at} WHERE id = ${id}`;
      },
      startProcessing: async (id, photoKey) => {
        const [row] =
          await tx`UPDATE media.uploads SET status = 'processing', photo_key = coalesce(photo_key, ${photoKey})
            WHERE id = ${id} RETURNING photo_key`;
        return /** @type {any} */ (row).photoKey;
      },
      markApproved: async (id, at) => {
        await tx`UPDATE media.uploads SET status = 'approved', photo_id = id, processed_at = ${at} WHERE id = ${id}`;
      },
      markRejected: async (id, reason, at) => {
        await tx`UPDATE media.uploads SET status = 'rejected', photo_id = id, error_code = ${reason}, processed_at = ${at}
          WHERE id = ${id}`;
      },
      remove: async (id) => {
        await tx`DELETE FROM media.uploads WHERE id = ${id}`;
      },
      removeForUser: async (userId) =>
        (await tx`DELETE FROM media.uploads WHERE user_id = ${userId}`).count,
    },
  };
}
