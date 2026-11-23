// @ts-check
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POSTGRES_IMAGE, startTestPostgres } from '@vouch/config/test/containers';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../migrations/run.js';
import { prepareRestore, restoreInto } from '../../scripts/backup.js';
import { createDatabase } from '../../src/platform/db.js';
import { HOOK_TIMEOUT_MS, startInfra } from '../platform/helpers.js';

/** pg_dump / pg_restore from the server's major version, on the host network. */
const pg = (/** @type {string[]} */ args, /** @type {string} */ dir) =>
  execFileSync(
    'docker',
    ['run', '--rm', '--network', 'host', '-v', `${dir}:/work`, POSTGRES_IMAGE, ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

/**
 * Phase 15 restore drill, locally: a dump of a live database restored into a NEW Postgres
 * (another cluster, as a new Render instance is) as a non-superuser login that owns the
 * database, following docs/runbooks/restore.md.
 */
describe('restore into a new database (docs/runbooks/restore.md)', () => {
  /** @type {Awaited<ReturnType<typeof startInfra>>} */
  let live;
  /** @type {Awaited<ReturnType<typeof startTestPostgres>>} */
  let fresh;
  let target = '';

  beforeAll(async () => {
    [live, fresh] = await Promise.all([startInfra(), startTestPostgres()]);
    const admin = postgres(fresh.url, { max: 1, onnotice: () => {} });
    await admin.unsafe(
      `CREATE ROLE restorer LOGIN PASSWORD 'restorer-pass' CREATEROLE NOSUPERUSER`,
    );
    await admin.unsafe('CREATE DATABASE restored OWNER restorer');
    await admin.end();
    const u = new URL(fresh.url);
    u.username = 'restorer';
    u.password = 'restorer-pass';
    u.pathname = '/restored';
    target = u.toString();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await Promise.all([live?.stop(), fresh?.stop()]);
  }, HOOK_TIMEOUT_MS);

  it('prepare-restore, pg_restore, migrate up: the data is back and the module roles work', async () => {
    await live.admin`INSERT INTO platform.campus_clusters (id, name, city)
      VALUES ('01900000-0000-7000-8000-0000000000aa', 'Restore drill', 'Noida')`;
    const dir = await mkdtemp(join(tmpdir(), 'vouch-drill-'));
    try {
      const started = performance.now();
      pg(
        ['pg_dump', '--format=custom', '--no-owner', '--file', '/work/db.dump', live.adminUrl],
        dir,
      );
      // The test cluster also has the test-only example module's role (not in production).
      await prepareRestore(target);
      const restorer = postgres(target, { max: 1, onnotice: () => {} });
      await restorer.unsafe('CREATE ROLE vouch_example NOLOGIN');
      await restorer.end();
      // pg_restore from a container: host paths under `dir` are /work inside it.
      const run = async (/** @type {string} */ command, /** @type {string[]} */ args) =>
        pg([command, ...args.map((a) => a.replace(dir, '/work'))], dir);
      const { migrations } = await restoreInto({
        targetUrl: target,
        file: join(dir, 'db.dump'),
        run,
        workDir: dir,
      });
      // The dump was current: no migration runs.
      expect(migrations).toEqual([]);
      expect(await migrate({ databaseUrl: target, direction: 'up' })).toEqual([]);
      const restoreMs = Math.round(performance.now() - started);

      const db = createDatabase({ url: target, max: 2 });
      try {
        const rows = await db.read(
          'platform',
          (tx) => tx`SELECT name FROM platform.campus_clusters
          WHERE id = '01900000-0000-7000-8000-0000000000aa'`,
        );
        expect(rows.map((r) => r.name)).toEqual(['Restore drill']);
        const [who] = await db.read('identity', (tx) => tx`SELECT current_user AS role`);
        expect(who?.role).toBe('vouch_identity');
        // A table created after the restore gets its module's grant (default privileges).
        const owner = postgres(target, { max: 1, onnotice: () => {} });
        await owner.unsafe('CREATE TABLE chat.after_restore (id int)');
        await owner.end();
        await db.read('chat', (tx) => tx`SELECT 1 FROM chat.after_restore`);
        // Grants came back with the schema: identity still cannot read chat.
        await expect(db.read('identity', (tx) => tx`SELECT 1 FROM chat.messages`)).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await db.end();
      }
      expect(restoreMs).toBeLessThan(120_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
