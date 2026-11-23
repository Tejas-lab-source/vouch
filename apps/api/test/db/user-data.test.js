// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_DATA } from '../../src/platform/jobs/consistency.js';
import { DB_HOOK_TIMEOUT_MS, startDatabase } from './helpers.js';

/** Columns that hold a user's internal id, by name. */
const USER_COLUMN =
  /^(user_id|sender_id|blocker_id|blocked_id|swiper_id|target_id|user_low|user_high|reporter_id|liker_id)$/;

/**
 * Columns that name a user but are not the user's own data, so they are erased differently or
 * kept deliberately (each with its reason).
 */
const EXEMPT = new Map([
  // Identity keeps the account row itself (status deleted, no email kept).
  ['identity.devices.user_id', 'revoked at deletion; purged by identity retention after 30 days'],
  ['identity.auth_sessions.user_id', 'revoked at deletion; purged after 30 days'],
  ['identity.consents.user_id', 'proof of consent, kept for the legal record (DPDP)'],
  // Safety keeps moderation records (ADR 0020).
  ['safety.reports.reporter_id', 'moderation record, evidence deleted 1 year after close'],
  ['safety.reports.target_id', 'moderation record, evidence deleted 1 year after close'],
  ['safety.bans.user_id', 'an active ban stays so the account cannot come back'],
]);

/**
 * Phase 14 invariant (deletion erases everywhere): every column that holds a user id in a
 * module schema is either checked by the nightly consistency job for deleted accounts
 * (`USER_DATA`) or exempt with a reason. A new table cannot silently keep a deleted user's
 * data.
 */
describe('user data coverage of the consistency check', () => {
  /** @type {Awaited<ReturnType<typeof startDatabase>>} */
  let db;
  beforeAll(async () => {
    db = await startDatabase();
  }, DB_HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await db?.stop();
  }, DB_HOOK_TIMEOUT_MS);

  it('every user-id column is in USER_DATA or exempt with a reason', async () => {
    const columns = await db.sql`SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'platform', 'admin',
          'public')
        AND t.table_type = 'BASE TABLE'
      ORDER BY 1, 2, 3`;
    const checked = new Set(USER_DATA.map(([table, column]) => `${table}.${column}`));
    const found = columns
      .filter((c) => USER_COLUMN.test(c.column_name))
      .map((c) => `${c.table_schema}.${c.table_name}.${c.column_name}`)
      // Partitions of a checked table inherit its check.
      .filter((name) => !/_p\d+\./.test(name));
    const uncovered = found.filter((name) => !checked.has(name) && !EXEMPT.has(name));
    expect(uncovered).toEqual([]);
    // The lists name only real columns.
    for (const name of [...checked, ...EXEMPT.keys()]) expect(found).toContain(name);
  });
});
