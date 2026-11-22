// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/platform/ids.js';
import {
  DB_HOOK_TIMEOUT_MS,
  MODULE_ROLES,
  PUBLISHED_VIEWS,
  asRole,
  startDatabase,
} from './helpers.js';

const PERMISSION_DENIED = '42501';
const WRITE = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const DISCOVERY = 'vouch_discovery';

/**
 * Narrow access every module role (including discovery since Phase 4) has to the platform event
 * tables. Module roles also hold a column-level SELECT on outbox.id, which has_table_privilege
 * does not count.
 */
const PLATFORM_GRANTS_FOR_MODULES = new Map([
  ['platform.outbox', ['INSERT']],
  ['platform.inbox', ['SELECT', 'INSERT']],
  ['platform.feature_flags', ['SELECT']],
  ['platform.deletion_tasks', ['SELECT', 'INSERT', 'UPDATE']],
]);

/** Extra grants beyond the defaults (Phase 10: admins edit feature flags, ADR 0018). */
const EXTRA_GRANTS = new Map([['admin platform.feature_flags', ['SELECT', 'INSERT', 'UPDATE']]]);

/** Tables whose rows may be added and purged but never edited. */
const APPEND_ONLY = new Set(['admin.audit_log']);

/**
 * The privileges a role is expected to hold on a relation.
 * @param {string} module  The role's own schema, or '' for discovery.
 * @param {string} relation  schema.name
 * @returns {string[]}
 */
function expectedPrivileges(module, relation) {
  const extra = EXTRA_GRANTS.get(`${module} ${relation}`);
  if (extra) return extra;
  if (PUBLISHED_VIEWS.includes(relation)) return ['SELECT'];
  const [schema] = relation.split('.');
  if (schema === module) {
    return APPEND_ONLY.has(relation) ? WRITE.filter((p) => p !== 'UPDATE') : WRITE;
  }
  if (module === 'platform') return [];
  return PLATFORM_GRANTS_FOR_MODULES.get(relation) ?? [];
}

describe('per-module roles', () => {
  /** @type {import('./helpers.js').TestDatabase} */
  let db;
  /** @type {string[]} */
  let relations;

  beforeAll(async () => {
    db = await startDatabase();
    const rows = await db.sql`
      SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v') AND n.nspname = ANY(${Object.keys(MODULE_ROLES)})`;
    relations = rows.map((row) => row.name);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.stop();
  }, DB_HOOK_TIMEOUT_MS);

  it('every role holds exactly the expected privileges on every table, partition and view', async () => {
    const roles = [...Object.entries(MODULE_ROLES), ['', DISCOVERY]];
    expect(relations.length).toBeGreaterThan(60);

    for (const [module, role] of roles) {
      const rows = await db.sql`
        SELECT rel, array_remove(ARRAY[
          CASE WHEN has_table_privilege(${role}, rel, 'SELECT') THEN 'SELECT' END,
          CASE WHEN has_table_privilege(${role}, rel, 'INSERT') THEN 'INSERT' END,
          CASE WHEN has_table_privilege(${role}, rel, 'UPDATE') THEN 'UPDATE' END,
          CASE WHEN has_table_privilege(${role}, rel, 'DELETE') THEN 'DELETE' END
        ], NULL) AS privileges
        FROM unnest(${relations}::text[]) AS rel`;
      const actual = Object.fromEntries(rows.map((row) => [row.rel, row.privileges]));
      const expected = Object.fromEntries(
        relations.map((rel) => [rel, expectedPrivileges(module, rel)]),
      );
      expect(actual, role).toEqual(expected);
    }
  });

  it('module roles can read only the outbox id they insert, never payloads', async () => {
    for (const role of [
      ...Object.values(MODULE_ROLES).filter((r) => r !== 'vouch_platform'),
      DISCOVERY,
    ]) {
      const [row] = await db.sql`
        SELECT has_column_privilege(${role}, 'platform.outbox', 'id', 'SELECT') AS id,
               has_column_privilege(${role}, 'platform.outbox', 'payload', 'SELECT') AS payload`;
      expect(row, role).toEqual({ id: true, payload: false });
    }
  });

  it('roles cannot log in, are not superusers and cannot create objects', async () => {
    const roles = [...Object.values(MODULE_ROLES), DISCOVERY, 'vouch_views'];
    const rows = await db.sql`
      SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb,
        (SELECT bool_or(has_schema_privilege(rolname, s, 'CREATE'))
           FROM unnest(${Object.keys(MODULE_ROLES)}::text[]) AS s) AS can_create
      FROM pg_roles WHERE rolname = ANY(${roles})`;

    expect(rows).toHaveLength(roles.length);
    for (const row of rows) {
      expect(row, row.rolname).toMatchObject({
        rolcanlogin: false,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        can_create: false,
      });
    }
  });

  it('the matching role cannot write chat.messages', async () => {
    await expect(
      asRole(
        db.sql,
        MODULE_ROLES.matching,
        (tx) => tx`
        INSERT INTO chat.messages (conversation_id, seq, sender_id, client_msg_id, body)
        VALUES (${uuidv7()}, 1, ${uuidv7()}, ${uuidv7()}, 'x')`,
      ),
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });

  it('the matching role can write its own tables and emit events', async () => {
    const [a, b] = [uuidv7(), uuidv7()];
    await asRole(db.sql, MODULE_ROLES.matching, async (tx) => {
      await tx`INSERT INTO matching.swipes (swiper_id, target_id, direction) VALUES (${a}, ${b}, 1)`;
      await tx`INSERT INTO platform.outbox (name, version, payload) VALUES ('match.created.v1', 1, '{}')`;
    });
  });

  it('the matching role cannot read the outbox it writes to', async () => {
    await expect(
      asRole(db.sql, MODULE_ROLES.matching, (tx) => tx`SELECT * FROM platform.outbox`),
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });

  it.each(PUBLISHED_VIEWS)('the discovery role can read %s', async (view) => {
    const [schema, name] = view.split('.');
    await asRole(db.sql, DISCOVERY, (tx) => tx`SELECT * FROM ${tx(schema)}.${tx(name)} LIMIT 1`);
  });

  it.each([
    'profiles.profiles',
    'matching.swipes',
    'safety.blocks',
    'identity.users',
    'platform.colleges',
  ])('the discovery role cannot read base table %s', async (table) => {
    const [schema, name] = table.split('.');
    await expect(
      asRole(db.sql, DISCOVERY, (tx) => tx`SELECT * FROM ${tx(schema)}.${tx(name)} LIMIT 1`),
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });

  it('the admin role cannot edit the append-only audit log', async () => {
    await expect(
      asRole(db.sql, MODULE_ROLES.admin, (tx) => tx`UPDATE admin.audit_log SET action = 'x.y'`),
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });
});
