// @ts-check
/**
 * Nightly backup (Phase 15; a Render Cron Job running the API image). Dumps the database with
 * `pg_dump --format=custom`, uploads it to R2 under the private `backups/<environment>/`
 * prefix (never served: the CDN serves `photos/` only), deletes dumps older than the
 * retention, and records the run in `platform.backup_runs` (the backup-age alert reads it).
 * Restore: docs/runbooks/restore.md.
 *
 * Usage (environment from the service):
 *   node scripts/backup.js                         take a backup (the cron job)
 *   node scripts/backup.js fetch latest dump.pgdump  download the newest dump (for a restore)
 *   node scripts/backup.js fetch <key> dump.pgdump   download one dump by its key
 *   node scripts/backup.js restore dump.pgdump       restore into a NEW, empty database
 *                                                    (RESTORE_DATABASE_URL), never the live one
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { grantModuleRoles, migrate, migrationDirs } from '../migrations/run.js';

const DAY_MS = 24 * 3600 * 1000;

/**
 * `pg_dump` of `databaseUrl` into `file` (custom format: compressed, restorable per table).
 * @param {string} databaseUrl @param {string} file
 */
export const pgDump = (databaseUrl, file) =>
  new Promise((resolve, reject) => {
    const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--file', file, databaseUrl], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(undefined) : reject(new Error(`pg_dump exited ${code}: ${stderr}`)),
    );
  });

/**
 * @param {{
 *   databaseUrl: string,
 *   s3: S3Client,
 *   bucket: string,
 *   environment: 'local' | 'staging' | 'production',
 *   retentionDays?: number,
 *   now?: () => Date,
 *   dump?: (databaseUrl: string, file: string) => Promise<unknown>,
 * }} options
 * @returns {Promise<{ key: string, bytes: number, deleted: number }>}
 */
export async function runBackup({
  databaseUrl,
  s3,
  bucket,
  environment,
  retentionDays = 14,
  now = () => new Date(),
  dump = pgDump,
}) {
  const dir = await mkdtemp(join(tmpdir(), 'vouch-backup-'));
  const file = join(dir, 'db.dump');
  const prefix = `backups/${environment}/`;
  try {
    const startedAt = now();
    await dump(databaseUrl, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- our own temp file
    const { size } = await stat(file);
    if (size === 0) throw new Error('pg_dump produced an empty file');
    const key = `${prefix}${startedAt.toISOString().replaceAll(':', '-')}.dump`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- our own temp file
        Body: await readFile(file),
        ContentType: 'application/octet-stream',
      }),
    );

    // Retention: delete this environment's dumps older than the window.
    const cutoff = startedAt.getTime() - retentionDays * DAY_MS;
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const old = (listed.Contents ?? []).filter(
      (o) => o.Key && o.Key !== key && (o.LastModified?.getTime() ?? 0) < cutoff,
    );
    if (old.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: old.map((o) => ({ Key: /** @type {string} */ (o.Key) })) },
        }),
      );
    }

    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`INSERT INTO platform.backup_runs (environment, object_key, bytes, taken_at)
        VALUES (${environment}, ${key}, ${size}, ${startedAt})`;
    } finally {
      await sql.end({ timeout: 5 });
    }
    return { key, bytes: size, deleted: old.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Downloads one dump to a local file: the newest for the environment, or a given key.
 * @param {{ s3: S3Client, bucket: string, environment: string, key?: string, file: string }} options
 * @returns {Promise<{ key: string, bytes: number }>}
 */
export async function fetchBackup({ s3, bucket, environment, key = 'latest', file }) {
  let chosen = key;
  if (key === 'latest') {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `backups/${environment}/` }),
    );
    // Keys are ISO timestamps, so the last in order is the newest.
    const keys = (listed.Contents ?? []).map((o) => String(o.Key)).sort();
    const newest = keys.at(-1);
    if (!newest) throw new Error(`no backups under backups/${environment}/`);
    chosen = newest;
  }
  if (!chosen.startsWith('backups/')) throw new Error('a backup key starts with backups/');
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: chosen }));
  const body = Buffer.from(await /** @type {any} */ (object.Body).transformToByteArray());
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's chosen file
  await writeFile(file, body, { mode: 0o600 });
  return { key: chosen, bytes: body.length };
}

/**
 * Creates the NOLOGIN module roles on a new database before `pg_restore`: on a new hosted
 * instance (a new cluster) they do not exist, and the dump's GRANTs need them. Runs the roles
 * migration's own SQL (idempotent) as the restoring login, then grants the roles to it.
 * @param {string} targetUrl
 */
export async function prepareRestore(targetUrl) {
  const file = new URL('../migrations/platform/20261121000100_platform_roles.sql', import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed migration file
  const text = await readFile(file, 'utf8');
  const up = text.split('-- Down Migration')[0] ?? '';
  const sql = postgres(targetUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(up);
  } finally {
    await sql.end({ timeout: 5 });
  }
  await grantModuleRoles(targetUrl);
}

/**
 * Every `ALTER DEFAULT PRIVILEGES` statement in the migrations (Up sections), so tables that
 * later migrations create get their module grants when the restoring login owns them.
 */
export async function defaultPrivilegeStatements() {
  const statements = [];
  for (const dir of migrationDirs()) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the migration folders
    for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a migration file
      const up = (await readFile(join(dir, name), 'utf8')).split('-- Down Migration')[0] ?? '';
      for (const match of up.matchAll(/ALTER DEFAULT PRIVILEGES[^;]+;/g)) statements.push(match[0]);
    }
  }
  return statements;
}

/** @param {string} command @param {string[]} args @returns {Promise<string>} */
function runTool(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} exited ${code}: ${err.trim()}`)),
    );
  });
}

/**
 * Restores a dump into a NEW, empty database owned by the restoring login
 * (docs/runbooks/restore.md):
 * 1. create the module roles and grant them to the login;
 * 2. `pg_restore --no-owner` everything except the dump's default-privilege entries, which
 *    name the old owner;
 * 3. `migrate up`: applies migrations newer than the dump and re-grants the roles;
 * 4. re-apply the migrations' default privileges as the new owner.
 * @param {{ targetUrl: string, file: string, run?: (command: string, args: string[]) => Promise<string>, workDir?: string }} options
 *   `run` runs pg_restore (a test passes a container's); `workDir` holds the list file.
 * @returns {Promise<{ migrations: string[] }>}
 */
export async function restoreInto({ targetUrl, file, run = runTool, workDir }) {
  await prepareRestore(targetUrl);
  const listing = await run('pg_restore', ['--list', file]);
  const kept = listing
    .split('\n')
    .filter((line) => !/ DEFAULT ACL /.test(line))
    .join('\n');
  const dir = workDir ?? (await mkdtemp(join(tmpdir(), 'vouch-restore-')));
  const listFile = join(dir, 'restore.list');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a temp file we made
  await writeFile(listFile, kept);
  await run('pg_restore', [
    '--no-owner',
    '--exit-on-error',
    '--use-list',
    listFile,
    '--dbname',
    targetUrl,
    file,
  ]);
  const migrations = await migrate({ databaseUrl: targetUrl, direction: 'up' });
  const sql = postgres(targetUrl, { max: 1, onnotice: () => {} });
  try {
    for (const statement of await defaultPrivilegeStatements()) await sql.unsafe(statement);
  } finally {
    await sql.end({ timeout: 5 });
  }
  if (!workDir) await rm(dir, { recursive: true, force: true });
  return { migrations };
}

async function main() {
  const env = process.env;
  if (process.argv[2] === 'restore') {
    const target = env.RESTORE_DATABASE_URL;
    const file = process.argv[3];
    if (!target || !file) {
      throw new Error(
        'usage: RESTORE_DATABASE_URL=<new database> node scripts/backup.js restore <file>',
      );
    }
    if (target === env.DATABASE_URL) throw new Error('refusing: that is the live database');
    const started = Date.now();
    const { migrations } = await restoreInto({ targetUrl: target, file });
    process.stdout.write(
      `${JSON.stringify({ msg: 'restored', migrationsApplied: migrations.length, seconds: Math.round((Date.now() - started) / 1000) })}\n`,
    );
    return;
  }
  const fetching = process.argv[2] === 'fetch';
  const required = [
    ...(fetching ? [] : ['DATABASE_URL']),
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ];
  const missing = required.filter((name) => !new Map(Object.entries(env)).get(name));
  if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);
  const environment = /** @type {'local' | 'staging' | 'production'} */ (env.DEPLOY_ENV ?? 'local');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: /** @type {string} */ (env.R2_ACCESS_KEY_ID),
      secretAccessKey: /** @type {string} */ (env.R2_SECRET_ACCESS_KEY),
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  if (fetching) {
    const [, , , key, file] = process.argv;
    if (!key || !file) throw new Error('usage: node scripts/backup.js fetch latest|<key> <file>');
    const fetched = await fetchBackup({
      s3,
      bucket: /** @type {string} */ (env.R2_BUCKET),
      environment,
      key,
      file,
    });
    process.stdout.write(`${JSON.stringify({ msg: 'backup fetched', ...fetched, file })}\n`);
    return;
  }
  const result = await runBackup({
    databaseUrl: /** @type {string} */ (env.DATABASE_URL),
    s3,
    bucket: /** @type {string} */ (env.R2_BUCKET),
    environment,
    retentionDays: Number(env.BACKUP_RETENTION_DAYS ?? 14),
  });
  // Logs carry the object key and size only (no connection strings).
  process.stdout.write(`${JSON.stringify({ msg: 'backup done', ...result })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ msg: 'backup failed', error: String(error) })}\n`);
    process.exitCode = 1;
  });
}
