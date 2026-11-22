// @ts-check
import {
  confirmUpload as confirmEndpoint,
  createUpload as createUploadEndpoint,
  deleteMyPhoto as deleteMyPhotoEndpoint,
  EVENTS,
  getMyProfile as getMyProfileEndpoint,
  ProfileCard,
  reorderMyPhotos as reorderMyPhotosEndpoint,
  updateMyProfile as updateMyProfileEndpoint,
} from '@vouch/contracts';
import { startTestStorage, TEST_STORAGE } from '@vouch/config/test/containers';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import modules from '../../../src/modules/index.js';
import { createS3Storage } from '../../../src/modules/media/adapters/storage/s3.js';
import { createPlatform, startRole } from '../../../src/platform/boot.js';
import { loadConfig } from '../../../src/platform/config.js';
import { createConsumer } from '../../../src/platform/events/consume.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  eventually,
  HOOK_TIMEOUT_MS,
  makeKeys,
  startInfra,
  testEnv,
} from '../../platform/helpers.js';
import { hasGpsIfd, jpegWithGps } from '../media/images.js';

const DOMAIN = 'northfield.example.edu';
const H = { 'x-app-version': '1.0.0' };
const SIGNUP = {
  birthDate: '2005-01-31',
  gradYear: 2028,
  consent: { noticeVersion: 'draft', purposes: ['matching'] },
};
const WAIT_MS = 30_000;

describe('profiles and media (ROLE=all, real Postgres, Redis and S3)', () => {
  /** @type {import('../../platform/helpers.js').Infra} */
  let infra;
  /** @type {import('@vouch/config/test/containers').TestStorage} */
  let s3;
  /** @type {import('../../../src/modules/media/ports.js').StorageProvider} */
  let storage;
  /** @type {any} */
  let app;
  /** @type {{ to: string, code: string }[]} */
  const mail = [];
  /** Content checks can be held open to test deletion during processing. */
  /** @type {null | Promise<void>} */
  let holdChecks = null;
  let checksSeen = 0;
  /** @type {Record<string, number>} */
  const timings = {};
  let n = 0;

  /** @param {string} url @param {any} payload @param {Record<string, string>} [headers] */
  const post = (url, payload, headers = {}) =>
    app.http.inject({
      method: 'POST',
      url,
      payload,
      headers: { ...H, 'idempotency-key': `k-${++n}-${Date.now()}`, ...headers },
    });
  /** @param {string} token */
  const auth = (token) => ({ ...H, authorization: `Bearer ${token}` });
  /** @param {string} token */
  const getProfile = async (token) => {
    const response = await app.http.inject({ url: '/v1/me/profile', headers: auth(token) });
    expect(response.statusCode).toBe(200);
    return getMyProfileEndpoint.response.schema.parse(response.json());
  };

  async function signUp() {
    const email = `photos${++n}@${DOMAIN}`;
    await post('/v1/auth/otp', { email, turnstileToken: 'dev' });
    const code = mail.filter((m) => m.to === email).at(-1)?.code;
    const verified = await post('/v1/auth/verify', {
      email,
      code,
      device: { platform: 'ios' },
      signup: SIGNUP,
    });
    expect(verified.statusCode).toBe(200);
    const body = verified.json();
    const [row] =
      await infra.admin`SELECT id FROM identity.users WHERE public_id = ${body.user.userId}`;
    return { token: body.tokens.accessToken, publicId: body.user.userId, userId: row.id };
  }

  /**
   * The client side of an upload: presign, PUT straight to storage, confirm.
   * @param {string} token
   * @param {Buffer} bytes
   * @param {'image/jpeg' | 'image/png' | 'image/webp'} [contentType]
   */
  async function uploadPhoto(token, bytes, contentType = 'image/jpeg') {
    const t0 = performance.now();
    const created = await post(
      '/v1/media/uploads',
      { contentType, sizeBytes: bytes.length },
      auth(token),
    );
    expect(created.statusCode).toBe(201);
    const upload = createUploadEndpoint.response.schema.parse(created.json());
    const t1 = performance.now();
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: bytes,
    });
    expect(put.status).toBe(200);
    const t2 = performance.now();
    const confirmed = await post(`/v1/media/uploads/${upload.uploadId}/confirm`, {}, auth(token));
    expect(confirmed.statusCode).toBe(202);
    expect(confirmEndpoint.response.schema.parse(confirmed.json()).status).toBe('processing');
    const t3 = performance.now();
    return { uploadId: upload.uploadId, ms: { presign: t1 - t0, put: t2 - t1, confirm: t3 - t2 } };
  }

  /** @param {string} token @param {string} photoId @param {string} status */
  const photoReaches = (token, photoId, status) =>
    eventually(async () => {
      const profile = await getProfile(token);
      const photo = profile.photos.find((/** @type {any} */ p) => p.id === photoId);
      return photo?.status === status ? { profile, photo } : null;
    }, WAIT_MS);

  beforeAll(async () => {
    [infra, s3] = await Promise.all([startInfra(), startTestStorage()]);
    const keys = await makeKeys({ kid: 'active-1' });
    await infra.admin`INSERT INTO platform.campus_clusters (id, name, city) VALUES ('01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60', 'Test', 'Pune')`;
    await infra.admin`INSERT INTO platform.colleges (id, name, email_domains, cluster_id, city)
      VALUES ('01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f', 'Northfield', ${[DOMAIN]}, '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60', 'Pune')`;
    const config = loadConfig(
      testEnv({
        ROLE: 'all',
        DATABASE_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
        R2_ENDPOINT: s3.endpoint,
        R2_ACCESS_KEY_ID: TEST_STORAGE.accessKeyId,
        R2_SECRET_ACCESS_KEY: TEST_STORAGE.secretAccessKey,
        R2_BUCKET: TEST_STORAGE.bucket,
        CDN_BASE_URL: s3.publicBaseUrl,
      }),
    );
    storage = createS3Storage({
      endpoint: s3.endpoint,
      accessKeyId: TEST_STORAGE.accessKeyId,
      secretAccessKey: TEST_STORAGE.secretAccessKey,
      bucket: TEST_STORAGE.bucket,
    });
    // SeaweedFS answers /healthz slightly before its filer accepts buckets.
    await eventually(
      () =>
        storage.ensureBucket().then(
          () => true,
          () => false,
        ),
      WAIT_MS,
    );
    // SeaweedFS allocates its first volume on the first write (seconds); do it before timing.
    await storage.write('uploads/warm-up', Buffer.from('x'), { contentType: 'text/plain' });
    await storage.remove(['uploads/warm-up']);
    const platform = await createPlatform({ config, logger: createLogger({ level: 'silent' }) });
    app = await startRole({
      platform: /** @type {any} */ ({
        ...platform,
        overrides: {
          identity: {
            email: {
              sendOtp: async (/** @type {any} */ m) => void mail.push({ to: m.to, code: m.code }),
            },
          },
          media: {
            contentCheck: {
              check: async () => {
                checksSeen += 1;
                await holdChecks;
                return { verdict: 'approve', reasons: [], provider: 'test' };
              },
            },
          },
        },
      }),
      modules,
      listen: false,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.stop(10_000);
    await Promise.all([infra?.stop(), s3?.stop()]);
  }, HOOK_TIMEOUT_MS);

  it('a new user gets one empty, pending profile; a redelivered user.created.v1 creates no second one', async () => {
    const user = await signUp();
    const profile = await getProfile(user.token);
    expect(profile).toMatchObject({
      userId: user.publicId,
      status: 'pending',
      name: null,
      minAge: 18,
      maxAge: 30,
      photos: [],
      missing: ['name', 'gender', 'interestedIn', 'photos'],
    });

    const consumer = app.boot.consumers.find(
      (/** @type {any} */ c) => c.module === 'profiles' && c.event === 'user.created.v1',
    );
    const deliver = createConsumer({
      db: app.platform.db,
      consumer: 'profiles',
      event: EVENTS['user.created.v1'],
      handler: consumer.handler,
    });
    const [event] = await infra.admin`SELECT id, payload, created_at FROM platform.outbox
      WHERE name = 'user.created.v1' AND payload->>'userId' = ${user.userId}`;
    const envelope = (/** @type {number} */ id) => ({
      data: {
        id,
        name: 'user.created.v1',
        version: 1,
        occurredAt: event.created_at.toISOString(),
        traceId: null,
        payload: event.payload,
      },
    });
    await eventually(
      async () =>
        (
          await infra.admin`SELECT 1 FROM platform.inbox WHERE consumer = 'profiles' AND event_id = ${event.id}`
        ).length === 1,
    );
    expect(await deliver(envelope(Number(event.id)))).toBe('duplicate');
    // Even a copy with a new event id (a replay) finds the profile already there.
    expect(await deliver(envelope(Number(event.id) + 1_000_000))).toBe('processed');
    const rows = await infra.admin`SELECT 1 FROM profiles.profiles WHERE user_id = ${user.userId}`;
    expect(rows).toHaveLength(1);
  });

  it('end to end: a Phase 5 user fills in the profile, uploads 2 photos and becomes active', async () => {
    const user = await signUp();
    const patched = await app.http.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(user.token),
      payload: { name: 'Aditi', gender: 0, interestedIn: [1], bio: 'Hello', maxAge: 26 },
    });
    expect(patched.statusCode).toBe(200);
    expect(updateMyProfileEndpoint.response.schema.parse(patched.json())).toMatchObject({
      status: 'pending',
      missing: ['photos'],
      maxAge: 26,
    });

    const started = performance.now();
    const photo = await jpegWithGps();
    const first = await uploadPhoto(user.token, photo);
    const approvedFirst = await photoReaches(user.token, first.uploadId, 'approved');
    timings.uploadToApprovedMs = performance.now() - started;
    Object.assign(timings, first.ms);
    expect(approvedFirst.profile.status).toBe('pending');

    const second = await uploadPhoto(user.token, await jpegWithGps({ width: 900, height: 1200 }));
    const { profile } = await photoReaches(user.token, second.uploadId, 'approved');
    timings.totalMs = performance.now() - started;
    expect(profile).toMatchObject({ status: 'active', missing: [] });
    expect(profile.photos.map((/** @type {any} */ p) => p.position)).toEqual([0, 1]);

    // Both variants are served anonymously from the CDN base URL, as WebP without any EXIF.
    const urls = approvedFirst.photo.urls;
    expect(urls?.w1080.startsWith(`${s3.publicBaseUrl}/photos/`)).toBe(true);
    expect(urls?.w1080).not.toContain(user.userId);
    for (const [url, width] of /** @type {const} */ ([
      [urls?.w1080, 1080],
      [urls?.w400, 400],
    ])) {
      const response = await fetch(String(url));
      expect(response.status).toBe(200);
      const bytes = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect(meta).toMatchObject({ format: 'webp', width });
      expect(meta.exif).toBeUndefined();
      expect(hasGpsIfd(bytes)).toBe(false);
      timings[`variant${width}KB`] = Math.round((bytes.length / 1024) * 10) / 10;
    }
    // Raw uploads and staged variants are gone, and raw objects were never public.
    expect(await storage.head(`uploads/raw/${first.uploadId}`)).toBeNull();
    expect(await storage.head(`uploads/processed/${first.uploadId}_1080.webp`)).toBeNull();

    const events = await infra.admin`SELECT payload FROM platform.outbox
      WHERE name = 'profile.updated.v1' AND payload->>'userId' = ${user.userId} ORDER BY id`;
    expect(events.at(-1)?.payload).toMatchObject({ status: 'active' });
    expect(events.at(-1)?.payload.changed).toEqual(['photos', 'status']);
    // The end-to-end timings for the report.
    process.stdout.write(`PHASE6_TIMINGS ${JSON.stringify(timings)}\n`);
  });

  it('cards: getCards returns a valid card, caches it in Redis, and an edit invalidates it', async () => {
    const user = await signUp();
    await app.http.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(user.token),
      payload: { name: 'Kabir', gender: 1, interestedIn: [0] },
    });
    for (const size of [800, 700]) {
      const { uploadId } = await uploadPhoto(
        user.token,
        await jpegWithGps({ width: size, height: size }),
      );
      await photoReaches(user.token, uploadId, 'approved');
    }
    const profilesApi = app.boot.apis.get('profiles');
    const [card] = await profilesApi.getCards([user.userId]);
    expect(ProfileCard.parse(card)).toMatchObject({ userId: user.publicId, name: 'Kabir' });
    const redis = app.platform.redis.command;
    const key = `profiles:card:${user.userId}`;
    expect(await redis.ttl(key)).toBeGreaterThan(590);

    await app.http.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(user.token),
      payload: { bio: 'Updated bio' },
    });
    expect(await redis.exists(key)).toBe(0);
    expect((await profilesApi.getCard(user.userId))?.bio).toBe('Updated bio');
    // Pending profiles have no card.
    const other = await signUp();
    expect(await profilesApi.getCards([other.userId, user.userId])).toHaveLength(1);
  });

  it('a non-image file renamed .jpg is rejected, shown to its owner with urls: null, and nothing is published', async () => {
    const user = await signUp();
    const fake = Buffer.from('#!/bin/sh\necho this is not a photo, just named photo.jpg\n');
    const { uploadId } = await uploadPhoto(user.token, fake, 'image/jpeg');
    const { photo } = await photoReaches(user.token, uploadId, 'rejected');
    expect(photo.urls).toBeNull();
    const [row] =
      await infra.admin`SELECT status, error_code, photo_key FROM media.uploads WHERE id = ${uploadId}`;
    expect(row).toMatchObject({ status: 'rejected', error_code: 'not_an_image' });
    expect(await storage.head(`photos/${row.photo_key}/${uploadId}_1080.webp`)).toBeNull();
    expect(await storage.head(`uploads/raw/${uploadId}`)).toBeNull();
    const [event] = await infra.admin`SELECT payload FROM platform.outbox
      WHERE name = 'photo.rejected.v1' AND payload->>'uploadId' = ${uploadId}`;
    expect(event?.payload.reason).toBe('not_an_image');
  });

  it('the upload CORS rule lets only the web origins PUT (preflight), with the signed content type', async () => {
    const web = 'http://localhost:5173';
    await createS3Storage({
      endpoint: s3.endpoint,
      ...TEST_STORAGE,
    }).applyUploadCors([web]);
    /** @param {string} origin @param {string} method */
    const preflight = (origin, method) =>
      fetch(`${s3.endpoint}/${TEST_STORAGE.bucket}/uploads/probe`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type',
        },
      });
    const allowed = await preflight(web, 'PUT');
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(web);
    expect(allowed.headers.get('access-control-allow-methods')).toBe('PUT');
    const foreign = await preflight('https://elsewhere.example', 'PUT');
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    const del = await preflight(web, 'DELETE');
    // A browser refuses any method missing from Allow-Methods.
    expect(del.headers.get('access-control-allow-methods') ?? '').not.toContain('DELETE');
  });

  it('storage enforces the signed size and type; confirm refuses anything else', async () => {
    const user = await signUp();
    const bytes = await jpegWithGps({ width: 300, height: 300 });
    const created = (
      await post(
        '/v1/media/uploads',
        { contentType: 'image/jpeg', sizeBytes: bytes.length },
        auth(user.token),
      )
    ).json();
    const bigger = await fetch(created.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: Buffer.concat([bytes, Buffer.alloc(100)]),
    });
    expect(bigger.status).toBe(403);
    const otherType = await fetch(created.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    expect(otherType.status).toBe(403);
    const confirm = await post(
      `/v1/media/uploads/${created.uploadId}/confirm`,
      {},
      auth(user.token),
    );
    expect(confirm.statusCode).toBe(409);
    expect(confirm.json().error.code).toBe('UPLOAD_NOT_UPLOADED');
    // Raw uploads are private even with the URL's key.
    expect((await fetch(`${s3.publicBaseUrl}/uploads/raw/${created.uploadId}`)).status).toBe(403);
  });

  it('allows 6 photos; deleting one frees its place, removes its files and is idempotent', async () => {
    const user = await signUp();
    /** @type {string[]} */
    const ids = [];
    for (let i = 0; i < 6; i += 1) {
      const { uploadId } = await uploadPhoto(
        user.token,
        await jpegWithGps({ width: 200 + i, height: 200 }),
      );
      ids.push(uploadId);
    }
    const seventh = await post(
      '/v1/media/uploads',
      { contentType: 'image/jpeg', sizeBytes: 1000 },
      auth(user.token),
    );
    expect(seventh.statusCode).toBe(409);
    expect(seventh.json().error.code).toBe('PHOTO_LIMIT_REACHED');

    const target = /** @type {string} */ (ids[2]);
    const { photo } = await photoReaches(user.token, target, 'approved');
    const deleted = await app.http.inject({
      method: 'DELETE',
      url: `/v1/me/photos/${target}`,
      headers: auth(user.token),
    });
    expect(deleted.statusCode).toBe(200);
    const after = deleteMyPhotoEndpoint.response.schema.parse(deleted.json());
    expect(after.photos.some((/** @type {any} */ p) => p.id === target)).toBe(false);
    const key = new URL(String(photo.urls?.w400)).pathname.split('/').slice(2).join('/');
    expect(await storage.head(key)).toBeNull();
    const again = await app.http.inject({
      method: 'DELETE',
      url: `/v1/me/photos/${target}`,
      headers: auth(user.token),
    });
    expect(again.statusCode).toBe(200);
    const freed = await post(
      '/v1/media/uploads',
      { contentType: 'image/jpeg', sizeBytes: 1000 },
      auth(user.token),
    );
    expect(freed.statusCode).toBe(201);
  });

  it('reorders photos: the new order is stored, and another user’s photo or a partial list is refused', async () => {
    const user = await signUp();
    const other = await signUp();
    const a = (await uploadPhoto(user.token, await jpegWithGps({ width: 300, height: 300 })))
      .uploadId;
    const b = (await uploadPhoto(user.token, await jpegWithGps({ width: 310, height: 300 })))
      .uploadId;
    const theirs = (await uploadPhoto(other.token, await jpegWithGps())).uploadId;
    await photoReaches(user.token, a, 'approved');
    await photoReaches(user.token, b, 'approved');
    await photoReaches(other.token, theirs, 'approved');
    /** @param {string} token @param {string[]} photoIds */
    const reorder = (token, photoIds) =>
      app.http.inject({
        method: 'PUT',
        url: '/v1/me/photos/order',
        payload: { photoIds },
        headers: auth(token),
      });
    const before = (await getProfile(user.token)).photos.map((/** @type {any} */ p) => p.id);
    expect(before).toEqual([a, b]);
    const moved = await reorder(user.token, [b, a]);
    expect(moved.statusCode).toBe(200);
    const view = reorderMyPhotosEndpoint.response.schema.parse(moved.json());
    expect(view.photos.map((/** @type {any} */ p) => [p.id, p.position])).toEqual([
      [b, 0],
      [a, 1],
    ]);
    expect((await getProfile(user.token)).photos.map((/** @type {any} */ p) => p.id)).toEqual([
      b,
      a,
    ]);
    for (const photoIds of [[b], [b, theirs], [b, a, theirs], [b, b]]) {
      const refused = await reorder(user.token, photoIds);
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.code).toBe('VALIDATION_FAILED');
    }
    // The other user's order is untouched.
    expect((await getProfile(other.token)).photos.map((/** @type {any} */ p) => p.id)).toEqual([
      theirs,
    ]);
  });

  it('a photo deleted while it is being processed stays deleted and leaves no files', async () => {
    const user = await signUp();
    /** @type {() => void} */
    let release = () => {};
    holdChecks = new Promise((resolve) => {
      release = () => resolve();
    });
    const seen = checksSeen;
    try {
      const { uploadId } = await uploadPhoto(user.token, await jpegWithGps());
      await photoReaches(user.token, uploadId, 'pending');
      await eventually(() => checksSeen > seen, WAIT_MS);
      const deleted = await app.http.inject({
        method: 'DELETE',
        url: `/v1/me/photos/${uploadId}`,
        headers: auth(user.token),
      });
      expect(deleted.statusCode).toBe(200);
      release();
      await eventually(
        async () =>
          (await infra.admin`SELECT 1 FROM media.uploads WHERE id = ${uploadId}`).length === 0,
        WAIT_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, 1500)); // let any late event arrive
      const [row] = await infra.admin`SELECT status FROM profiles.photos WHERE id = ${uploadId}`;
      expect(row?.status).toBe('deleted');
      expect((await getProfile(user.token)).photos).toEqual([]);
    } finally {
      release();
      holdChecks = null;
    }
  });

  it('export includes the profile and uploads; deleting the account erases profile, uploads and files', async () => {
    const user = await signUp();
    await app.http.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(user.token),
      payload: { name: 'Meera' },
    });
    const { uploadId } = await uploadPhoto(user.token, await jpegWithGps());
    const { photo } = await photoReaches(user.token, uploadId, 'approved');
    const exported = (
      await app.http.inject({ url: '/v1/me/export', headers: auth(user.token) })
    ).json();
    expect(exported.data.profiles.profile).toMatchObject({
      name: 'Meera',
      birthDate: '2005-01-31',
    });
    expect(exported.data.media.uploads).toEqual([
      expect.objectContaining({ id: uploadId, status: 'approved' }),
    ]);

    const removed = await app.http.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { ...auth(user.token), 'idempotency-key': `del-${++n}` },
    });
    expect(removed.statusCode).toBe(202);
    await eventually(async () => {
      const [profiles, uploads] = await Promise.all([
        infra.admin`SELECT 1 FROM profiles.profiles WHERE user_id = ${user.userId}`,
        infra.admin`SELECT 1 FROM media.uploads WHERE user_id = ${user.userId}`,
      ]);
      return profiles.length === 0 && uploads.length === 0;
    }, WAIT_MS);
    const key = new URL(String(photo.urls?.w1080)).pathname.split('/').slice(2).join('/');
    expect(await storage.head(key)).toBeNull();
    expect(
      await infra.admin`SELECT 1 FROM profiles.photos WHERE user_id = ${user.userId}`,
    ).toHaveLength(0);
  });

  it('retention SQL deletes only finished rows older than 7 days', async () => {
    const user = await signUp();
    const { uploadId } = await uploadPhoto(user.token, Buffer.from('not an image'));
    await photoReaches(user.token, uploadId, 'rejected');
    const kept = await uploadPhoto(user.token, await jpegWithGps());
    await photoReaches(user.token, kept.uploadId, 'approved');
    await infra.admin`UPDATE media.uploads SET created_at = now() - interval '8 days'
      WHERE user_id = ${user.userId}`;
    const job = app.boot.jobs.find((/** @type {any} */ j) => j.name === 'media.retentionTick');
    expect(await job.handler()).toEqual({ deleted: 1 });
    const rows = await infra.admin`SELECT id FROM media.uploads WHERE user_id = ${user.userId}`;
    expect(rows.map((r) => r.id)).toEqual([kept.uploadId]);
  });

  it('putSection: no section types exist in v1', async () => {
    const user = await signUp();
    const response = await app.http.inject({
      method: 'PUT',
      url: '/v1/me/profile/sections/prompts',
      headers: { ...auth(user.token), 'content-type': 'application/json' },
      payload: { schemaVersion: 1, position: 0, data: { answer: 'x' } },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('UNKNOWN_SECTION_TYPE');
  });
});
