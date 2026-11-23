// @ts-check

const DAY_MS = 24 * 3600 * 1000;
/** Events are delivered asynchronously: rows younger than this are not yet violations. */
const SETTLE_MS = 15 * 60 * 1000;
export const CONSISTENCY_CRON = '37 4 * * *';

/**
 * Tables that must hold nothing of a user once their deletion has been processed, with the
 * column naming the user (matches are anonymised, never deleted, and are checked by id).
 * Reports and active bans are kept on purpose (moderation records and ban evasion).
 */
export const USER_DATA = Object.freeze([
  ['profiles.profiles', 'user_id'],
  ['profiles.photos', 'user_id'],
  ['profiles.profile_sections', 'user_id'],
  ['media.uploads', 'user_id'],
  ['safety.blocks', 'blocker_id'],
  ['safety.blocks', 'blocked_id'],
  ['safety.verification_reviews', 'user_id'],
  ['safety.photo_rejections', 'user_id'],
  ['matching.swipes', 'swiper_id'],
  ['matching.swipes', 'target_id'],
  ['matching.matches', 'user_low'],
  ['matching.matches', 'user_high'],
  ['chat.conversations', 'user_low'],
  ['chat.conversations', 'user_high'],
  ['chat.messages', 'sender_id'],
  ['chat.read_cursors', 'user_id'],
  ['chat.member_settings', 'user_id'],
  ['notifications.prefs', 'user_id'],
  ['notifications.deliveries', 'user_id'],
]);

/**
 * The nightly consistency check (roadmap Phase 10, task 4). It runs as `vouch_platform`, which
 * has column-level SELECT on ids and timestamps only, and counts:
 * - `matches_without_conversation`: active matches older than 15 minutes with no conversation
 * - `conversations_without_match`: conversations whose match does not exist
 * - `deleted_users_with_data`: accounts deleted more than 24 h ago that still have rows
 * - `deletions_overdue`: (account, module) erasures not finished within 24 h
 * Each count is a gauge `vouch_consistency_violations{check}`; any count above 0 is logged as
 * an error (the alert).
 * @param {{
 *   db: import('../db.js').Database,
 *   logger: import('pino').Logger,
 *   metrics: { setGauge: (name: string, help: string, labels: Record<string, string>, value: number) => void },
 *   clock: { now: () => Date },
 *   subscriptions: Map<string, readonly string[]>,
 * }} deps
 */
export function createConsistencyCheck({ db, logger, metrics, clock, subscriptions }) {
  return async function consistencyCheck() {
    const now = clock.now().getTime();
    const settled = new Date(now - SETTLE_MS);
    const deletedBefore = new Date(now - DAY_MS);
    const deletionConsumers = [...(subscriptions.get('user.deleted.v1') ?? [])];
    const counts = await db.read('platform', async (tx) => {
      const n = (/** @type {any[]} */ rows) => Number(rows[0]?.n ?? 0);
      const matchesWithout = n(
        await tx`SELECT count(*)::int AS n FROM matching.matches m
          WHERE m.unmatched_at IS NULL AND m.anonymised_at IS NULL AND m.created_at < ${settled}
            AND NOT EXISTS (SELECT 1 FROM chat.conversations c WHERE c.id = m.id)`,
      );
      const conversationsWithout = n(
        await tx`SELECT count(*)::int AS n FROM chat.conversations c
          WHERE NOT EXISTS (SELECT 1 FROM matching.matches m WHERE m.id = c.id)`,
      );
      let deletedWithData = 0;
      for (const [table, column] of USER_DATA) {
        deletedWithData += n(
          await tx.unsafe(
            `SELECT count(DISTINCT u.id)::int AS n FROM identity.users u
              WHERE u.status = 'deleted' AND u.deleted_at < $1
                AND EXISTS (SELECT 1 FROM ${table} t WHERE t.${column} = u.id)`,
            [deletedBefore],
          ),
        );
      }
      const overdue = n(
        await tx`SELECT count(*)::int AS n FROM identity.users u
          CROSS JOIN unnest(${deletionConsumers}::text[]) AS m(module)
          WHERE u.status = 'deleted' AND u.deleted_at < ${deletedBefore}
            AND NOT EXISTS (SELECT 1 FROM platform.deletion_tasks d
              WHERE d.user_id = u.id AND d.module = m.module AND d.completed_at IS NOT NULL)`,
      );
      return {
        matches_without_conversation: matchesWithout,
        conversations_without_match: conversationsWithout,
        deleted_users_with_data: deletedWithData,
        deletions_overdue: overdue,
      };
    });
    for (const [check, value] of Object.entries(counts)) {
      metrics.setGauge(
        'vouch_consistency_violations',
        'Cross-module invariant violations found by the nightly check.',
        { check },
        value,
      );
    }
    const violations = Object.entries(counts).filter(([, value]) => value > 0);
    if (violations.length > 0) {
      logger.error({ counts }, 'consistency check found violations');
    } else {
      logger.info({ counts }, 'consistency check passed');
    }
    return counts;
  };
}
