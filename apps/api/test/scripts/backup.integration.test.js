// @ts-check
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { POSTGRES_IMAGE, startTestStorage, TEST_STORAGE } from '@vouch/config/test/containers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBackup } from '../../scripts/backup.js';
import { HOOK_TIMEOUT_MS, startInfra } from '../platform/helpers.js';

/**
 * `pg_dump` from the same major version as the server (the test container's image), on the
 * host network so it reaches the container's mapped port.
 * @param {string} databaseUrl @param {string} file
 */
const dockerDump = async (databaseUrl, file) => {
  const dir = dirname(file);
  execFileSync('docker', [
    'run',
    '--rm',
    '--network',
    'host',
    '-v',
    `${dir}:/out`,
    POSTGRES_IMAGE,
    'pg_dump',
    '--format=custom',
    '--no-owner',
    '--file',
    '/out/db.dump',
    databaseUrl,
  ]);
};

describe('nightly backup (Phase 15)', () => {
  /** @type {Awaited<ReturnType<typeof startInfra>>} */
  let infra;
  /** @type {Awaited<ReturnType<typeof startTestStorage>>} */
  let storage;
  /** @type {S3Client} */
  let s3;

  beforeAll(async () => {
    [infra, storage] = await Promise.all([startInfra(), startTestStorage()]);
    s3 = new S3Client({
      region: 'auto',
      endpoint: storage.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: TEST_STORAGE.accessKeyId,
        secretAccessKey: TEST_STORAGE.secretAccessKey,
      },
    });
    await s3.send(new CreateBucketCommand({ Bucket: TEST_STORAGE.bucket }));
    await infra.admin`INSERT INTO platform.campus_clusters (id, name, city)
      VALUES ('01900000-0000-7000-8000-000000000001', 'Backup test', 'Noida')`;
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await Promise.all([infra?.stop(), storage?.stop()]);
  }, HOOK_TIMEOUT_MS);

  it('uploads a restorable dump under backups/<env>/, records it, and keeps 14 days', async () => {
    const options = {
      databaseUrl: infra.adminUrl,
      s3,
      bucket: TEST_STORAGE.bucket,
      environment: /** @type {const} */ ('staging'),
      dump: dockerDump,
    };
    const first = await runBackup(options);
    expect(first.key).toMatch(/^backups\/staging\/\d{4}-\d{2}-\d{2}T.*\.dump$/);
    expect(first.bytes).toBeGreaterThan(1000);

    // The dump restores: pg_restore lists the table and its row.
    const dir = await mkdtemp(join(tmpdir(), 'vouch-restore-'));
    try {
      const object = await s3.send(
        new GetObjectCommand({ Bucket: TEST_STORAGE.bucket, Key: first.key }),
      );
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a temp dir we made
      await writeFile(
        join(dir, 'db.dump'),
        Buffer.from(await /** @type {any} */ (object.Body).transformToByteArray()),
      );
      const listing = execFileSync(
        'docker',
        ['run', '--rm', '-v', `${dir}:/in`, POSTGRES_IMAGE, 'pg_restore', '--list', '/in/db.dump'],
        { encoding: 'utf8' },
      );
      expect(listing).toContain('TABLE DATA platform campus_clusters');
      expect(listing).toContain('TABLE DATA identity users');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    // A run 15 days later deletes the first dump (retention 14 days) and is recorded too.
    const later = await runBackup({ ...options, now: () => new Date(Date.now() + 15 * 864e5) });
    expect(later.deleted).toBe(1);
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: TEST_STORAGE.bucket, Prefix: 'backups/' }),
    );
    expect((listed.Contents ?? []).map((o) => o.Key)).toEqual([later.key]);
    const runs = await infra.admin`SELECT environment, object_key FROM platform.backup_runs
      ORDER BY id`;
    expect(runs.map((r) => r.object_key)).toEqual([first.key, later.key]);
  }, 180_000);
});
