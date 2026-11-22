// @ts-check

/** How long identity keeps expired, revoked and deleted records (docs/data-model.md). */
export const IDENTITY_RETENTION_MS = Object.freeze({
  sessions: 30 * 24 * 3600 * 1000,
  devices: 30 * 24 * 3600 * 1000,
  deletedUsers: 30 * 24 * 3600 * 1000,
});

/**
 * Runs one retention task inside the caller's transaction.
 * @param {{ purgeSessions: (d: Date) => Promise<number>, purgeDevices: (d: Date) => Promise<number>, purgeDeletedUsers: (d: Date) => Promise<number> }} retention
 * @param {'sessions' | 'devices' | 'deletedUsers'} task
 * @param {Date} olderThan
 * @returns {Promise<number>} Rows deleted.
 */
export function runRetention(retention, task, olderThan) {
  if (task === 'sessions') return retention.purgeSessions(olderThan);
  if (task === 'devices') return retention.purgeDevices(olderThan);
  return retention.purgeDeletedUsers(olderThan);
}
