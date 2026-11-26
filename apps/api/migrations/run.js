// @ts-check
import { readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import postgres from 'postgres';
import { z } from 'zod';

/** Table (in the `public` schema) recording which migrations have run. */
export const MIGRATIONS_TABLE = 'pgmigrations';

const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Migration folders, in dependency order. Files from all folders run together in
 * timestamp order, so a module's timestamps must come after the platform's.
 * Kept explicit (like the module list) rather than discovered from the filesystem.
 */
const SOURCES = [
  '../migrations/platform/',
  '../src/modules/identity/migrations/',
  '../src/modules/profiles/migrations/',
  '../src/modules/media/migrations/',
  '../src/modules/safety/migrations/',
  '../src/modules/matching/migrations/',
  '../src/modules/chat/migrations/',
  '../src/modules/notifications/migrations/',
  '../src/modules/admin/migrations/',
];

/**
 * Absolute paths of every migration folder.
 * @returns {string[]}
 */
export function migrationDirs() {
  return SOURCES.map((source) => fileURLToPath(new URL(source, import.meta.url)));
}

/**
 * Names of every migration on disk (file name without `.sql`), sorted as the runner applies them.
 * @returns {string[]}
 */
export function listMigrationNames() {
  return (
    migrationDirs()
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed list of folders
      .flatMap((dir) => readdirSync(dir).filter((file) => file.endsWith('.sql')))
      .map((file) => file.slice(0, -'.sql'.length))
      .sort()
  );
}

/**
 * @typedef {object} MigrateOptions
 * @property {string} databaseUrl  Connection URL of a role allowed to create schemas and roles.
 * @property {'up' | 'down'} direction
 * @property {number} [count]  How many migrations to run; defaults to all (up) or 1 (down).
 * @property {(message: string) => void} [log]  Receives progress lines; silent by default.
 */

/**
 * Applies or reverts migrations from every module in timestamp order.
 * @param {MigrateOptions} options
 * @returns {Promise<string[]>} Names of the migrations that ran.
 */
export async function migrate({ databaseUrl, direction, count, log = () => {} }) {
  const ran = await runner({
    databaseUrl: { connectionString: databaseUrl, connectionTimeoutMillis: CONNECT_TIMEOUT_MS },
    dir: migrationDirs().map((dir) => `${dir}*.sql`),
    useGlob: true,
    direction,
    count: count ?? (direction === 'up' ? Infinity : 1),
    migrationsTable: MIGRATIONS_TABLE,
    migrationsSchema: 'public',
    checkOrder: true,
    singleTransaction: true,
    logger: { debug: () => {}, info: log, warn: log, error: log },
  });
  if (direction === 'up') await grantModuleRoles(databaseUrl, log);
  return ran.map((migration) => migration.name);
}

/**
 * Lets the migrating login switch into every module role (Phase 15). On a hosted database
 * (Render) one login owns the database, creates the NOLOGIN module roles in migrations, and
 * the app uses `SET ROLE vouch_<module>` per transaction. Since Postgres 16 the creator of a
 * role holds only ADMIN on it, not SET, so this grants `SET TRUE, INHERIT FALSE`: the login
 * can switch into each role but does not hold its privileges itself. Idempotent; a no-op for
 * a superuser and for a login that already has the grants. Runs after every `up`, so a
 * module role added later is covered too.
 * @param {string} databaseUrl
 * @param {(line: string) => void} [log]
 */
export async function grantModuleRoles(databaseUrl, log = () => {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    const missing = await sql`SELECT rolname FROM pg_roles
      WHERE rolname LIKE 'vouch\_%' AND NOT rolcanlogin
        AND NOT pg_has_role(current_user, oid, 'SET')
      ORDER BY rolname`;
    for (const { rolname } of missing) {
      // Only our own role names reach the statement (GRANT takes no parameters).
      if (!/^vouch_[a-z_]+$/.test(rolname)) continue;
      await sql.unsafe(`GRANT "${rolname}" TO CURRENT_USER WITH SET TRUE, INHERIT FALSE`);
      log(`granted ${rolname} (SET) to the migrating login`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const cliSchema = z.object({
  direction: z.enum(['up', 'down']),
  count: z.coerce.number().int().positive().optional(),
  all: z.boolean(),
  databaseUrl: z.url({ protocol: /^postgres(ql)?$/ }),
});

/**
 * CLI: `node migrations/run.js up|down [--count N] [--all]`, reading DATABASE_URL.
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { count: { type: 'string' }, all: { type: 'boolean', default: false } },
  });
  const options = cliSchema.parse({
    direction: positionals[0],
    count: values.count,
    all: values.all,
    databaseUrl: process.env.DATABASE_URL,
  });
  const count = options.all ? Infinity : options.count;
  const write = (/** @type {string} */ line) => process.stdout.write(`${line}\n`);
  const ran = await migrate({ ...options, count, log: write });
  write(`${options.direction}: ${ran.length} migration(s) ran`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
