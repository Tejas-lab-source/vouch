// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeedData, seed } from '../../scripts/seed.js';
import { DB_HOOK_TIMEOUT_MS, startDatabase } from './helpers.js';

describe('seed script', () => {
  /** @type {import('./helpers.js').TestDatabase} */
  let db;

  beforeAll(async () => {
    db = await startDatabase();
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.stop();
  }, DB_HOOK_TIMEOUT_MS);

  it('builds identical data on every call (seeded random)', () => {
    expect(buildSeedData()).toEqual(buildSeedData());
  });

  it(
    'creates 2 colleges in 1 cluster and exactly 2,000 users, idempotently',
    async () => {
      const first = await seed(db.sql);
      const second = await seed(db.sql);

      expect(first).toMatchObject({ clusters: 1, colleges: 2, users: 2000, profiles: 2000 });
      expect(first.photos).toBeGreaterThanOrEqual(4000);
      expect(second).toEqual(first);
    },
    DB_HOOK_TIMEOUT_MS,
  );

  it('produces only eligible, adult, active candidates with at least 2 approved photos', async () => {
    const [row] = await db.sql`
      SELECT count(*)::int AS candidates, min(approved_photos)::int AS min_photos,
        count(DISTINCT cluster_id)::int AS clusters
      FROM profiles.candidates_v`;

    expect(row).toEqual({ candidates: 2000, min_photos: 2, clusters: 1 });
  });

  it('builds photo keys as photos/{photoKey}/{photoId}_{size}.webp, never with a user id', () => {
    const { users, photos } = /** @type {{ users: any[], photos: any[] }} */ (buildSeedData());
    const userIds = new Set(users.map((u) => u.id));
    const keyPattern = /^photos\/[A-Za-z0-9_-]{22}\/[0-9a-f-]{36}_(1080|400)\.webp$/;
    const photoKeys = new Set();
    for (const photo of photos) {
      for (const key of [photo.key_1080, photo.key_400]) {
        expect(key).toMatch(keyPattern);
        expect(key).toContain(photo.id);
        expect(key).not.toContain(photo.user_id);
        const [, photoKey = '', file = ''] = key.split('/');
        expect(userIds.has(photoKey) || userIds.has(file.split('_')[0] ?? '')).toBe(false);
      }
      photoKeys.add(photo.key_1080.split('/')[1]);
    }
    expect(photoKeys.size).toBe(photos.length); // one random key per photo
    expect(userIds.size).toBe(2000);
  });

  it('stores no plaintext email and uses only reserved example domains', async () => {
    const colleges = await db.sql`SELECT email_domains FROM platform.colleges`;
    for (const { email_domains: domains } of colleges) {
      for (const domain of domains) expect(domain).toMatch(/\.example\.edu$/);
    }
    const [{ columns }] = await db.sql`
      SELECT count(*)::int AS columns FROM information_schema.columns
      WHERE table_schema = 'identity' AND column_name ILIKE '%email%' AND column_name <> 'email_hmac'`;
    expect(columns).toBe(0);
  });
});
