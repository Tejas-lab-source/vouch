// @ts-check
import { ServiceError } from '@vouch/contracts';
import { isValidTimeZone } from '../domain/quiet-hours.js';
import { prefsView } from './push.js';

const DIGEST_BATCH = 500;
const RETENTION_MS = 90 * 24 * 3600 * 1000;

/**
 * Preferences, the daily likes digest and delivery retention.
 * @param {import('../ports.js').NotificationDeps & ReturnType<typeof import('./push.js').makePush>} deps
 */
export function makePrefs(deps) {
  const { useCase, uow, read, matching, queue, clock } = deps;

  const putPrefs = useCase(
    'notifications.putPrefs',
    /** @param {ReturnType<typeof prefsView>} input */
    async (input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      if (!isValidTimeZone(input.timezone)) {
        throw new ServiceError('VALIDATION_FAILED', { message: 'Unknown time zone.' });
      }
      await uow.run(({ stores }) => stores.prefs.upsert(userId, input, clock.now()));
      return prefsView(await read((stores) => stores.prefs.find(userId)));
    },
  );

  /** `GET /v1/me/notification-prefs`: the saved values, or the defaults. */
  const getPrefs = useCase('notifications.getPrefs', async (/** @type {unknown} */ _input, ctx) => {
    const userId = /** @type {string} */ (ctx.actor?.userId);
    return prefsView(await read((stores) => stores.prefs.find(userId)));
  });

  /**
   * `notifications.likesDigest` (daily): one `likes.digest` push per user with unanswered
   * likes (a count, never who). Idempotent per user per day.
   */
  async function likesDigest() {
    const day = clock.now().toISOString().slice(0, 10);
    let afterId = null;
    let queued = 0;
    for (;;) {
      /** @type {{ userId: string, likes: number }[]} */
      const batch = await matching.pendingLikes({ afterId, limit: DIGEST_BATCH });
      for (const { userId, likes } of batch) {
        const outcome = await queue({
          userId,
          template: 'likes.digest',
          params: { count: String(likes) },
          dedupeKey: `likes:${userId}:${day}`,
        });
        if (outcome === 'queued') queued += 1;
      }
      if (batch.length < DIGEST_BATCH) break;
      afterId = batch.at(-1)?.userId ?? null;
    }
    return { queued };
  }

  /** `notifications.retentionTick` (nightly): delivery log rows older than 90 days. */
  const retention = () =>
    uow.run(({ stores }) =>
      stores.deliveries.purge(new Date(clock.now().getTime() - RETENTION_MS)),
    );

  /** Personal-data export: the user's push preferences. @param {string} userId */
  const exportFor = async (userId) => ({
    notificationPrefs: prefsView(await read((stores) => stores.prefs.find(userId))),
  });

  return { putPrefs, getPrefs, likesDigest, retention, exportFor };
}
