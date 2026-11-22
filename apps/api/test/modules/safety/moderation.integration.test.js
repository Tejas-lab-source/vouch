// @ts-check
import { startTestStorage, TEST_STORAGE } from '@vouch/config/test/containers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import modules from '../../../src/modules/index.js';
import { createS3Storage } from '../../../src/modules/media/adapters/storage/s3.js';
import { createPlatform, startRole } from '../../../src/platform/boot.js';
import { loadConfig } from '../../../src/platform/config.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  eventually,
  HOOK_TIMEOUT_MS,
  makeKeys,
  startInfra,
  testEnv,
} from '../../platform/helpers.js';
import { jpegWithGps } from '../media/images.js';
import { facesReply, labelsReply, startFakeRekognition } from './fake-rekognition.js';

const DOMAIN = 'northfield.example.edu';
const H = { 'x-app-version': '1.0.0' };
const SIGNUP = {
  birthDate: '2005-01-31',
  gradYear: 2028,
  consent: { noticeVersion: 'draft', purposes: ['matching'] },
};
const WAIT_MS = 45_000;

describe('photo moderation through safety.contentChecks (Rekognition adapter, fake endpoint)', () => {
  /** @type {import('../../platform/helpers.js').Infra} */
  let infra;
  /** @type {import('@vouch/config/test/containers').TestStorage} */
  let s3;
  /** @type {Awaited<ReturnType<typeof startFakeRekognition>>} */
  let rekognition;
  /** @type {any} */
  let app;
  /** @type {{ to: string, code: string }[]} */
  const mail = [];
  /** What the fake Rekognition answers for the next calls. */
  let mode = /** @type {'clean' | 'explicit' | 'borderline' | 'minor' | 'down'} */ ('clean');
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

  async function signUp() {
    const email = `mod${++n}@${DOMAIN}`;
    await post('/v1/auth/otp', { email, turnstileToken: 'dev' });
    const code = mail.filter((m) => m.to === email).at(-1)?.code;
    const body = (
      await post('/v1/auth/verify', { email, code, device: { platform: 'ios' }, signup: SIGNUP })
    ).json();
    return body.tokens.accessToken;
  }

  /** @param {string} token */
  async function upload(token) {
    const bytes = await jpegWithGps({ width: 600, height: 800 });
    const created = (
      await post(
        '/v1/media/uploads',
        { contentType: 'image/jpeg', sizeBytes: bytes.length },
        auth(token),
      )
    ).json();
    await fetch(created.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: bytes,
    });
    await post(`/v1/media/uploads/${created.uploadId}/confirm`, {}, auth(token));
    return /** @type {string} */ (created.uploadId);
  }

  /** @param {string} uploadId @param {string} status */
  const uploadReaches = (uploadId, status) =>
    eventually(async () => {
      const [row] =
        await infra.admin`SELECT status, error_code FROM media.uploads WHERE id = ${uploadId}`;
      return row?.status === status ? row : null;
    }, WAIT_MS);

  beforeAll(async () => {
    [infra, s3] = await Promise.all([startInfra(), startTestStorage()]);
    rekognition = await startFakeRekognition((op) => {
      if (mode === 'down')
        return { status: 500, json: { __type: 'InternalServerError', message: 'down' } };
      if (op === 'DetectFaces')
        return {
          json: facesReply(mode === 'minor' ? [{ low: 14, high: 17 }] : [{ low: 22, high: 30 }]),
        };
      if (mode === 'explicit')
        return { json: labelsReply([{ name: 'Explicit Nudity', confidence: 96 }]) };
      if (mode === 'borderline')
        return { json: labelsReply([{ name: 'Explicit Nudity', confidence: 63 }]) };
      return { json: labelsReply([{ name: 'Swimwear or Underwear', confidence: 99 }]) };
    });
    const keys = await makeKeys({ kid: 'active-1' });
    await infra.admin`INSERT INTO platform.campus_clusters (id, name, city) VALUES ('01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60', 'Test', 'Pune')`;
    await infra.admin`INSERT INTO platform.colleges (id, name, email_domains, cluster_id, city)
      VALUES ('01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f', 'Northfield', ${[DOMAIN]}, '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60', 'Pune')`;
    const storage = createS3Storage({
      endpoint: s3.endpoint,
      accessKeyId: TEST_STORAGE.accessKeyId,
      secretAccessKey: TEST_STORAGE.secretAccessKey,
      bucket: TEST_STORAGE.bucket,
    });
    await eventually(
      () =>
        storage.ensureBucket().then(
          () => true,
          () => false,
        ),
      WAIT_MS,
    );
    await storage.write('uploads/warm-up', Buffer.from('x'), { contentType: 'text/plain' });
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
        MODERATION_PROVIDER: 'rekognition',
        MODERATION_ENDPOINT: rekognition.endpoint,
        MODERATION_AWS_ACCESS_KEY_ID: 'AKIDTEST',
        MODERATION_API_KEY: 'test-secret',
      }),
    );
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
        },
      }),
      modules,
      listen: false,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.stop(10_000);
    await Promise.all([infra?.stop(), s3?.stop(), rekognition?.stop()]);
  }, HOOK_TIMEOUT_MS);

  it('the chain is owned by safety, with the Rekognition step', () => {
    expect(app.platform.pipelines.steps('safety.contentChecks')).toEqual([
      'safety.imageModeration',
    ]);
  });

  it('suggestive content is approved; the image reaches the provider as JPEG bytes', async () => {
    mode = 'clean';
    const token = await signUp();
    const id = await upload(token);
    await uploadReaches(id, 'approved');
    const call = rekognition.calls.find((c) => c.op === 'DetectModerationLabels');
    expect(Buffer.from(call?.body.Image.Bytes, 'base64').subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
  });

  it('explicit content at 80%+ is rejected as moderation', async () => {
    mode = 'explicit';
    const id = await upload(await signUp());
    expect(await uploadReaches(id, 'rejected')).toMatchObject({ error_code: 'moderation' });
  });

  it('a 50–80% finding, or a face estimated under 18, holds the photo for review (shown to its owner as pending)', async () => {
    mode = 'borderline';
    const token = await signUp();
    const borderline = await upload(token);
    await uploadReaches(borderline, 'in_review');
    mode = 'minor';
    const minor = await upload(token);
    await uploadReaches(minor, 'in_review');
    const profile = (await app.http.inject({ url: '/v1/me/profile', headers: auth(token) })).json();
    expect(profile.photos.map((/** @type {any} */ p) => p.status)).toEqual(['pending', 'pending']);
    // The moderation queue (Phase 10) resolves it.
    expect(await app.boot.apis.get('media').resolveReview(minor, 'approve')).toBe('approved');
    await eventually(async () => {
      const p = (await app.http.inject({ url: '/v1/me/profile', headers: auth(token) })).json();
      return p.photos.find((/** @type {any} */ x) => x.id === minor)?.status === 'approved';
    }, WAIT_MS);
  });

  it('fails closed: with the provider failing, the photo is never approved, and after 3 attempts it is rejected', async () => {
    mode = 'down';
    const id = await upload(await signUp());
    expect(await uploadReaches(id, 'rejected')).toMatchObject({ error_code: 'processing_failed' });
    mode = 'clean';
  }, 90_000);
});
