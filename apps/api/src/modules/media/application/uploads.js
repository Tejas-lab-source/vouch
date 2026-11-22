// @ts-check
import { photoUploaded, ServiceError } from '@vouch/contracts';
import { countsTowardLimit, judgeConfirm, keys } from '../domain/upload.js';

/**
 * `createUpload` and `confirmUpload`. Photo bytes never pass through the API: the client PUTs
 * straight to storage with a presigned URL whose content type and length are signed.
 * @param {import('../ports.js').MediaDeps} deps
 */
export function makeUploadUseCases(deps) {
  const { useCase, uow, storage, settings, clock, newId, lockKey } = deps;
  const ttlMs = settings.uploadUrlTtlSeconds * 1000;

  const createUpload = useCase(
    'media.createUpload',
    /** @param {{ contentType: 'image/jpeg' | 'image/png' | 'image/webp', sizeBytes: number }} input */
    async (input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      if (input.sizeBytes > settings.uploadMaxBytes) throw new ServiceError('FILE_TOO_LARGE');
      const now = clock.now();
      const id = newId();

      await uow.run(async ({ tx, stores }) => {
        // Serialise this user's presigns so two parallel requests cannot both pass the limit.
        await lockKey(tx, `media:uploads:${userId}`);
        const uploads = await stores.uploads.listForUser(userId);
        const live = uploads.filter((u) => countsTowardLimit(u, now, ttlMs)).length;
        if (live >= settings.photosMax) throw new ServiceError('PHOTO_LIMIT_REACHED');
        await stores.uploads.insert({
          id,
          userId,
          rawKey: keys.raw(id),
          contentType: input.contentType,
          maxBytes: input.sizeBytes,
          createdAt: now,
        });
      });

      const url = await storage.presignPut({
        key: keys.raw(id),
        contentType: input.contentType,
        contentLength: input.sizeBytes,
        expiresInSeconds: settings.uploadUrlTtlSeconds,
      });
      return {
        uploadId: id,
        url,
        method: /** @type {const} */ ('PUT'),
        headers: { 'content-type': input.contentType, 'content-length': String(input.sizeBytes) },
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      };
    },
    { idempotent: true },
  );

  const confirmUpload = useCase(
    'media.confirmUpload',
    /** @param {{ id: string }} input */
    async (input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      const found = await deps.read((stores) => stores.uploads.findForUser(input.id, userId));
      if (!found) throw new ServiceError('NOT_FOUND');
      const object = found.status === 'pending' ? await storage.head(found.rawKey) : null;

      return uow.run(async ({ stores, emit }) => {
        const upload = await stores.uploads.findForUpdate(input.id);
        if (!upload || upload.userId !== userId) throw new ServiceError('NOT_FOUND');
        const verdict = judgeConfirm(upload, upload.status === 'pending' ? object : null);
        if (verdict === 'not_uploaded') throw new ServiceError('UPLOAD_NOT_UPLOADED');
        if (verdict !== 'confirm') return { uploadId: upload.id, status: verdict.already };

        const at = clock.now();
        await stores.uploads.markUploaded(upload.id, at);
        await emit(photoUploaded, {
          uploadId: upload.id,
          userId,
          rawKey: upload.rawKey,
          contentType: upload.contentType,
          confirmedAt: at.toISOString(),
        });
        return { uploadId: upload.id, status: /** @type {const} */ ('processing') };
      });
    },
  );

  return { createUpload, confirmUpload };
}
