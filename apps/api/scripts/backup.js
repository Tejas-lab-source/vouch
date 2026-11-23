// @ts-check
/**
 * Nightly backup (Phase 15; a Render Cron Job running the API image). Dumps the database with
 * `pg_dump --format=custom`, uploads it to R2 under the private `backups/<environment>/`
 * prefix (never served: the CDN serves `photos/` only), deletes dumps older than the
 * retention, and records the run in `platform.backup_runs` (the backup-age alert reads it).
 * Restore: docs/runbooks/restore.md.
 *
 * Usage (environment from the service): node scripts/backup.js
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import postgres from 'postgres';

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

async function main() {
  const env = process.env;
  const required = ['DATABASE_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
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
