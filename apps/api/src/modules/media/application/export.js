// @ts-check

/**
 * Media's part of the data export: the user's upload records (no object keys, which are
 * internal; approved photos are exported by profiles with their URLs).
 * @param {Pick<import('../ports.js').MediaDeps, 'read'>} deps
 */
export function makeMediaExport({ read }) {
  /** @param {string} userId */
  return async (userId) => ({
    uploads: (await read((stores) => stores.uploads.listForUser(userId))).map((u) => ({
      id: u.id,
      status: u.status,
      contentType: u.contentType,
      sizeBytes: u.maxBytes,
      rejectedBecause: u.errorCode,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}
