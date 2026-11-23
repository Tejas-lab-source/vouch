// @ts-check

/**
 * The reporter id of reports safety files itself (repeat photo offences). A fixed UUIDv7 that
 * no user can have (users get time-ordered ids from 2026 on).
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-7000-8000-000000000001';

/** Public id shown for a user whose account has been erased (reports outlive accounts). */
export const ERASED_PUBLIC_ID = 'erased-account-0000';

/** Moderation actions on a report and the status each leaves it in. */
export const REPORT_ACTIONS = new Map([
  ['dismiss', 'dismissed'],
  ['warn', 'actioned'],
  ['hide', 'actioned'],
  ['unhide', 'actioned'],
  ['ban', 'actioned'],
]);

/**
 * Whether a profile should be hidden pending review: at least `threshold` distinct people
 * reported it within the window (owner default: 3 in 7 days).
 * @param {number} distinctReporters
 * @param {number} threshold
 */
export const shouldAutoHide = (distinctReporters, threshold) => distinctReporters >= threshold;

/**
 * Whether a run of moderation rejections opens a system report. Only `moderation` rejections
 * count (a file that is not an image is not an offence).
 * @param {{ reason: string, rejectionsInWindow: number, threshold: number, alreadyOpen: boolean }} input
 */
export const isRepeatOffence = ({ reason, rejectionsInWindow, threshold, alreadyOpen }) =>
  reason === 'moderation' && !alreadyOpen && rejectionsInWindow >= threshold;

/**
 * Whether a ban is active at `now`.
 * @param {{ liftedAt: Date | null, expiresAt: Date | null }} ban
 * @param {Date} now
 */
export const banActive = (ban, now) =>
  ban.liftedAt === null && (ban.expiresAt === null || ban.expiresAt > now);

/**
 * Opaque keyset cursor `<iso>|<uuid>`, base64url.
 * @param {{ at: Date, id: string }} position
 */
export const encodeCursor = ({ at, id }) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

/**
 * @param {string | undefined} cursor
 * @returns {{ at: Date, id: string } | null}
 */
export function decodeCursor(cursor) {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) return null;
  return { at, id: /** @type {string} */ (id) };
}
