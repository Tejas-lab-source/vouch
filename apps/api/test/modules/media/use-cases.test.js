// @ts-check
import { describe, expect, it } from 'vitest';
import { buildMediaHandlers } from '../../../src/modules/media/adapters/wiring.js';
import { processImageJob } from '../../../src/modules/media/adapters/jobs/process-image.js';
import { createMediaApi } from '../../../src/modules/media/api.js';
import { fakeMediaDeps, USER } from './fakes.js';
import { jpegWithGps } from './images.js';

const CTX = {
  actor: {
    userId: USER,
    audience: /** @type {const} */ ('vouch:user'),
    mfa: false,
    sessionId: 's1',
  },
};

/** @param {Parameters<typeof fakeMediaDeps>[0]} [options] */
function setup(options) {
  const fake = fakeMediaDeps(options);
  return { ...fake, h: buildMediaHandlers(fake.deps) };
}

/**
 * Presigns, "uploads" `body` straight into the fake bucket and confirms.
 * @param {ReturnType<typeof setup>} s
 * @param {Buffer} body
 */
async function upload(s, body, contentType = /** @type {const} */ ('image/jpeg')) {
  const created = await s.h.createUpload({ contentType, sizeBytes: body.length }, CTX);
  s.state.objects.set(`uploads/raw/${created.uploadId}`, { body, contentType });
  await s.h.confirmUpload({ id: created.uploadId }, CTX);
  return created.uploadId;
}

describe('createUpload and confirmUpload', () => {
  it('signs the exact size and type for uploads/raw/{uploadId}, and records it as pending', async () => {
    const s = setup();
    const created = await s.h.createUpload({ contentType: 'image/png', sizeBytes: 1234 }, CTX);
    expect(s.state.presigned[0]).toEqual({
      key: `uploads/raw/${created.uploadId}`,
      contentType: 'image/png',
      contentLength: 1234,
      expiresInSeconds: 600,
    });
    expect(created).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'content-length': '1234' },
      expiresAt: '2026-11-22T10:10:00.000Z',
    });
    expect(s.state.uploads.get(created.uploadId)?.status).toBe('pending');
  });

  it('refuses uploads over UPLOAD_MAX_BYTES', async () => {
    const s = setup();
    s.deps.settings.uploadMaxBytes = 1000;
    await expect(
      buildMediaHandlers(s.deps).createUpload({ contentType: 'image/jpeg', sizeBytes: 1001 }, CTX),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('allows 6 live photos; rejected ones and expired presigns free their place', async () => {
    const s = setup();
    for (let i = 0; i < 6; i += 1)
      await s.h.createUpload({ contentType: 'image/jpeg', sizeBytes: 10 }, CTX);
    await expect(
      s.h.createUpload({ contentType: 'image/jpeg', sizeBytes: 10 }, CTX),
    ).rejects.toMatchObject({ code: 'PHOTO_LIMIT_REACHED' });
    const [first] = s.state.uploads.values();
    first.status = 'rejected';
    await s.h.createUpload({ contentType: 'image/jpeg', sizeBytes: 10 }, CTX);
    s.advance(600_000);
    await s.h.createUpload({ contentType: 'image/jpeg', sizeBytes: 10 }, CTX);
  });

  it('confirm refuses a missing object or one of another size, and emits photo.uploaded.v1 once', async () => {
    const s = setup();
    const { uploadId } = await s.h.createUpload({ contentType: 'image/jpeg', sizeBytes: 5 }, CTX);
    await expect(s.h.confirmUpload({ id: uploadId }, CTX)).rejects.toMatchObject({
      code: 'UPLOAD_NOT_UPLOADED',
    });
    s.state.objects.set(`uploads/raw/${uploadId}`, {
      body: Buffer.from('123456'),
      contentType: 'image/jpeg',
    });
    await expect(s.h.confirmUpload({ id: uploadId }, CTX)).rejects.toMatchObject({
      code: 'UPLOAD_NOT_UPLOADED',
    });
    s.state.objects.set(`uploads/raw/${uploadId}`, {
      body: Buffer.from('12345'),
      contentType: 'image/jpeg',
    });
    expect(await s.h.confirmUpload({ id: uploadId }, CTX)).toEqual({
      uploadId,
      status: 'processing',
    });
    expect(await s.h.confirmUpload({ id: uploadId }, CTX)).toEqual({
      uploadId,
      status: 'processing',
    });
    expect(s.state.events.map((e) => e.name)).toEqual(['photo.uploaded.v1']);
    await expect(
      s.h.confirmUpload({ id: '01936f3e-0000-7000-8000-000000000000' }, CTX),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('image processing', () => {
  it('approved: variants under photos/{photoKey}/, private objects removed, photo.approved.v1 emitted', async () => {
    const s = setup();
    const id = await upload(s, await jpegWithGps());
    expect(await s.h.processing.processUpload({ uploadId: id })).toBe('approved');
    expect([...s.state.objects.keys()].sort()).toEqual([
      `photos/${'R'.repeat(22)}/${id}_1080.webp`,
      `photos/${'R'.repeat(22)}/${id}_400.webp`,
    ]);
    expect(s.state.objects.get(`photos/${'R'.repeat(22)}/${id}_400.webp`)?.cacheControl).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(s.state.events.at(-1)).toMatchObject({
      name: 'photo.approved.v1',
      payload: { photoId: id, uploadId: id, userId: USER },
    });
    // A retry after success is a no-op.
    expect(await s.h.processing.processUpload({ uploadId: id })).toBe('finished');
    expect(s.state.events.filter((e) => e.name === 'photo.approved.v1')).toHaveLength(1);
  });

  it('a renamed non-image is rejected as not_an_image and nothing reaches photos/', async () => {
    const s = setup();
    const id = await upload(s, Buffer.from('this is a text file named photo.jpg'));
    expect(await s.h.processing.processUpload({ uploadId: id })).toBe('rejected');
    expect(s.state.events.at(-1)).toMatchObject({
      name: 'photo.rejected.v1',
      payload: { photoId: id, reason: 'not_an_image' },
    });
    expect(s.state.objects.size).toBe(0);
  });

  it('a PNG declared as JPEG is rejected (magic bytes must match the declared type)', async () => {
    const s = setup();
    const { png } = await import('./images.js');
    const id = await upload(s, await png(100, 100), 'image/jpeg');
    expect(await s.h.processing.processUpload({ uploadId: id })).toBe('rejected');
  });

  it('moderation reject removes the staged variants; review keeps the upload processing', async () => {
    const rejecting = setup({ verdict: 'reject' });
    const id = await upload(rejecting, await jpegWithGps());
    expect(await rejecting.h.processing.processUpload({ uploadId: id })).toBe('rejected');
    expect(rejecting.state.events.at(-1)?.payload.reason).toBe('moderation');
    expect(rejecting.state.objects.size).toBe(0);

    const review = setup({ verdict: 'review' });
    const held = await upload(review, await jpegWithGps());
    expect(await review.h.processing.processUpload({ uploadId: held })).toBe('review');
    expect(review.state.uploads.get(held)?.status).toBe('processing');
    expect([...review.state.objects.keys()].some((k) => k.startsWith('photos/'))).toBe(false);
  });

  it('a photo deleted while it is processed is discarded: nothing is left in storage', async () => {
    /** @type {() => Promise<void>} */
    let duringCheck = async () => {};
    const s = setup({ onCheck: () => duringCheck() });
    const id = await upload(s, await jpegWithGps());
    duringCheck = async () => {
      await createMediaApi(s.deps).releaseUpload(id, USER);
    };
    expect(await s.h.processing.processUpload({ uploadId: id })).toBe('released');
    expect(s.state.objects.size).toBe(0);
    expect(s.state.events.map((e) => e.name)).toEqual(['photo.uploaded.v1']);
  });

  it('a retry reuses the photo key, so it overwrites instead of leaving orphans', async () => {
    let fail = true;
    const s = setup();
    const id = await upload(s, await jpegWithGps());
    const write = s.deps.storage.write;
    s.deps.storage.write = async (key, ...rest) => {
      if (key.startsWith('photos/') && fail) throw new Error('storage timeout');
      return write(key, ...rest);
    };
    await expect(s.h.processing.processUpload({ uploadId: id })).rejects.toThrow('storage timeout');
    const key = s.state.uploads.get(id)?.photoKey;
    fail = false;
    expect(await s.h.processing.processUpload({ uploadId: id })).toBe('approved');
    expect(s.state.uploads.get(id)?.photoKey).toBe(key);
  });

  it('the job retries infrastructure errors and rejects as processing_failed on the last attempt', async () => {
    const s = setup();
    const id = await upload(s, await jpegWithGps());
    s.state.objects.delete(`uploads/raw/${id}`); // storage lost the raw object
    const job = processImageJob({ processing: s.h.processing, logger: s.deps.logger });
    const attempt = (/** @type {number} */ made) =>
      job(
        /** @type {any} */ ({ data: { uploadId: id }, attemptsMade: made, opts: { attempts: 3 } }),
      );
    await expect(attempt(0)).rejects.toThrow();
    await expect(attempt(1)).rejects.toThrow();
    expect(await attempt(2)).toEqual({ outcome: 'rejected' });
    expect(s.state.events.at(-1)?.payload.reason).toBe('processing_failed');
  });
});

describe('media API', () => {
  it('deleteObjects accepts only photos/ and uploads/ keys', async () => {
    const s = setup();
    const api = createMediaApi(s.deps);
    s.state.objects.set('photos/a/b_400.webp', { body: Buffer.from('x'), contentType: 'x' });
    await api.deleteObjects(['photos/a/b_400.webp', 'uploads/raw/zzz']);
    expect(s.state.objects.size).toBe(0);
    await expect(api.deleteObjects(['../etc/passwd'])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(api.photoUrl('photos/a/b_400.webp')).toBe('https://cdn.test/photos/a/b_400.webp');
  });

  it('releaseUpload only releases the owner’s upload and is idempotent', async () => {
    const s = setup();
    const id = await upload(s, await jpegWithGps());
    const api = createMediaApi(s.deps);
    expect(await api.releaseUpload(id, '01936f3e-0000-7000-8000-00000000beef')).toEqual({
      released: false,
    });
    expect(await api.releaseUpload(id, USER)).toEqual({ released: true });
    expect(await api.releaseUpload(id, USER)).toEqual({ released: false });
    expect(s.state.objects.size).toBe(0);
  });
});
