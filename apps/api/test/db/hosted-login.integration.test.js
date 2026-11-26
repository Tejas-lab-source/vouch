// @ts-check
import { startTestContainers } from '@vouch/config/test/containers';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listMigrationNames, migrate } from '../../migrations/run.js';
import { createDatabase } from '../../src/platform/db.js';
import { HOOK_TIMEOUT_MS } from '../platform/helpers.js';

/**
 * Phase 15: a hosted database (Render) gives one login that owns the database and may create
 * roles, but is not a superuser. Migrations create the module roles as that login, and the
 * app then switches into them with SET ROLE, which on Postgres 16+ needs an explicit grant.
 */
describe('migrations and module roles as a hosted, non-superuser login', () => {
  /** @type {Awaited<ReturnType<typeof startTestContainers>>} */
  let containers;
  let url = '';

  beforeAll(async () => {
    containers = await startTestContainers();
    const admin = postgres(containers.postgresUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE ROLE hosted LOGIN PASSWORD 'hosted-pass' CREATEROLE NOSUPERUSER`);
    await admin.unsafe('CREATE DATABASE hosted_db OWNER hosted');
    await admin.end();
    const u = new URL(containers.postgresUrl);
    u.username = 'hosted';
    u.password = 'hosted-pass';
    u.pathname = '/hosted_db';
    url = u.toString();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await containers?.stop();
  }, HOOK_TIMEOUT_MS);

  it('applies every migration, and the login can use each module role; a rerun is a no-op', async () => {
    const ran = await migrate({ databaseUrl: url, direction: 'up' });
    expect(ran).toEqual(listMigrationNames());
    const db = createDatabase({ url, max: 2 });
    try {
      const modules = /** @type {const} */ (['platform', 'identity', 'chat', 'admin']);
      for (const module of modules) {
        const [row] = await db.read(module, (tx) => tx`SELECT current_user AS role`);
        expect(row?.role).toBe(`vouch_${module}`);
      }
      // Module isolation still holds for this login: identity cannot read chat's tables.
      await expect(
        db.read('identity', (tx) => tx`SELECT 1 FROM chat.messages LIMIT 1`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.end();
    }
    expect(await migrate({ databaseUrl: url, direction: 'up' })).toEqual([]);
  }, 120_000);
});
