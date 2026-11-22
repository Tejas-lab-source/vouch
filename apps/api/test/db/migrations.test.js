// @ts-check
import { glob, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrationDirs } from '../../migrations/run.js';
import { DB_HOOK_TIMEOUT_MS, PUBLISHED_VIEWS, startDatabase } from './helpers.js';

const EXPECTED_MIGRATIONS = [
  '20261121000100_platform_roles',
  '20261121000200_platform_schema',
  '20261121001000_identity_schema',
  '20261121002000_profiles_schema',
  '20261121003000_media_schema',
  '20261121004000_safety_schema',
  '20261121005000_matching_schema',
  '20261121006000_chat_schema',
  '20261121007000_notifications_schema',
  '20261121008000_admin_schema',
  '20261121009000_discovery_event_grants',
  '20261122002100_photo_tombstones',
  '20261122003100_upload_photo_key',
];

/** Every v1 table (excluding partitions), per roadmap Phase 2 Task 5 and the owner's decisions. */
const EXPECTED_TABLES = [
  'admin.admin_users',
  'admin.audit_log',
  'chat.conversations',
  'chat.messages',
  'chat.read_cursors',
  'identity.auth_sessions',
  'identity.consents',
  'identity.devices',
  'identity.users',
  'matching.matches',
  'matching.swipes',
  'media.uploads',
  'notifications.deliveries',
  'notifications.prefs',
  'platform.campus_clusters',
  'platform.colleges',
  'platform.deletion_tasks',
  'platform.feature_flags',
  'platform.inbox',
  'platform.outbox',
  'profiles.photos',
  'profiles.profile_sections',
  'profiles.profiles',
  'safety.bans',
  'safety.blocks',
  'safety.reports',
  'safety.verification_reviews',
];

const SCHEMAS = [
  'admin',
  'chat',
  'identity',
  'matching',
  'media',
  'notifications',
  'platform',
  'profiles',
  'safety',
];

/** @param {import('postgres').Sql} sql */
async function listTables(sql) {
  const rows = await sql`
    SELECT n.nspname || '.' || c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname = ANY(${SCHEMAS})`;
  return rows.map((row) => row.name).sort();
}

/** @param {import('postgres').Sql} sql */
async function listViews(sql) {
  const rows = await sql`
    SELECT schemaname || '.' || viewname AS name FROM pg_views
    WHERE schemaname = ANY(${SCHEMAS})`;
  return rows.map((row) => row.name).sort();
}

/** @param {import('postgres').Sql} sql */
async function countVouchObjects(sql) {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM pg_namespace WHERE nspname = ANY(${SCHEMAS})) AS schemas,
      (SELECT count(*)::int FROM pg_roles
        WHERE rolname LIKE 'vouch\\_%' AND rolname <> current_user) AS roles`;
  return row;
}

describe('migrations', () => {
  /** @type {import('./helpers.js').TestDatabase} */
  let db;

  beforeAll(async () => {
    db = await startDatabase({ migrated: false });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.stop();
  }, DB_HOOK_TIMEOUT_MS);

  it('every migration file declares a down section', async () => {
    const files = [];
    for (const dir of migrationDirs()) {
      for await (const file of glob(`${dir}*.sql`)) files.push(file);
    }
    expect(files).toHaveLength(EXPECTED_MIGRATIONS.length);
    for (const file of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths come from the fixed migration list
      expect(await readFile(file, 'utf8'), file).toMatch(/^-- Down Migration$/m);
    }
  });

  it(
    'applies every migration up, in timestamp order, on an empty database',
    async () => {
      const ran = await migrate({ databaseUrl: db.url, direction: 'up' });

      expect(ran).toEqual(EXPECTED_MIGRATIONS);
      expect(await listTables(db.sql)).toEqual(EXPECTED_TABLES);
      expect(await listViews(db.sql)).toEqual(PUBLISHED_VIEWS);
      expect(await countVouchObjects(db.sql)).toEqual({ schemas: 9, roles: 11 });
    },
    DB_HOOK_TIMEOUT_MS,
  );

  it(
    'reverts every migration down, leaving no schemas or roles behind',
    async () => {
      const ran = await migrate({ databaseUrl: db.url, direction: 'down', count: Infinity });

      expect(ran).toEqual([...EXPECTED_MIGRATIONS].reverse());
      expect(await countVouchObjects(db.sql)).toEqual({ schemas: 0, roles: 0 });
    },
    DB_HOOK_TIMEOUT_MS,
  );

  it(
    'applies every migration up again after a full revert',
    async () => {
      const ran = await migrate({ databaseUrl: db.url, direction: 'up' });

      expect(ran).toEqual(EXPECTED_MIGRATIONS);
      expect(await listTables(db.sql)).toEqual(EXPECTED_TABLES);
      expect(await listViews(db.sql)).toEqual(PUBLISHED_VIEWS);
    },
    DB_HOOK_TIMEOUT_MS,
  );

  it(
    'is a no-op when everything is already applied',
    async () => {
      expect(await migrate({ databaseUrl: db.url, direction: 'up' })).toEqual([]);
    },
    DB_HOOK_TIMEOUT_MS,
  );
});
