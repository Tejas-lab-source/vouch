// @ts-check
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
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
  return ran.map((migration) => migration.name);
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
