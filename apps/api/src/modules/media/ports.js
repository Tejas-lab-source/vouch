// @ts-check

/**
 * @typedef {import('./domain/upload.js').UploadStatus} UploadStatus
 *
 * @typedef {object} UploadRecord
 * @property {string} id  Also the photo id once processed (owner decision, Phase 6).
 * @property {string} userId
 * @property {string} rawKey
 * @property {'image/jpeg' | 'image/png' | 'image/webp'} contentType
 * @property {number} maxBytes  The exact size fixed in the presigned URL.
 * @property {UploadStatus} status
 * @property {string | null} photoKey  Random key for the photo's public variants.
 * @property {string | null} errorCode
 * @property {Date} createdAt
 */

/**
 * @typedef {object} UploadStore
 * @property {(upload: { id: string, userId: string, rawKey: string, contentType: string, maxBytes: number, createdAt: Date }) => Promise<void>} insert
 * @property {(id: string, userId: string) => Promise<UploadRecord | null>} findForUser
 * @property {(id: string) => Promise<UploadRecord | null>} findForUpdate  Locks the row.
 * @property {(userId: string) => Promise<UploadRecord[]>} listForUser
 * @property {(id: string, at: Date) => Promise<void>} markUploaded
 * @property {(id: string, photoKey: string) => Promise<string>} startProcessing
 *   Sets `processing` and keeps an existing photo key (retries reuse it); returns the key.
 * @property {(id: string, at: Date) => Promise<void>} markApproved
 * @property {(id: string, reason: string, at: Date) => Promise<void>} markRejected
 * @property {(id: string) => Promise<void>} remove
 * @property {(userId: string) => Promise<number>} removeForUser
 * @property {(olderThan: Date, limit: number) => Promise<{ id: string, photoKey: string | null }[]>} purgeFinished
 *   Deletes up to `limit` rejected, expired or never-confirmed rows created before `olderThan`.
 */

/** @typedef {{ uploads: UploadStore }} MediaStores */

/**
 * Object storage (Cloudflare R2; SeaweedFS locally). Implemented by `adapters/storage/s3.js`.
 * @typedef {object} StorageProvider
 * @property {(input: { key: string, contentType: string, contentLength: number, expiresInSeconds: number }) => Promise<string>} presignPut
 *   A URL that accepts exactly one PUT with this content type and length.
 * @property {(key: string) => Promise<{ contentLength: number, contentType: string | null } | null>} head
 * @property {(key: string, maxBytes: number) => Promise<Buffer>} read
 * @property {(key: string, body: Buffer, options: { contentType: string, cacheControl?: string }) => Promise<void>} write
 * @property {(keys: readonly string[]) => Promise<void>} remove  Missing keys are ignored.
 * @property {() => Promise<void>} ensureBucket  Development and tests only.
 */

/**
 * @typedef {object} ProcessedImage
 * @property {Map<import('./domain/upload.js').VariantName, { data: Buffer, width: number, height: number }>} variants
 * @property {{ width: number, height: number, format: string }} source
 */

/**
 * Decodes, auto-rotates, strips metadata and resizes. Implemented with sharp.
 * @typedef {object} ImageProcessor
 * @property {(input: Buffer) => Promise<ProcessedImage>} process
 *   Throws `ImageRejected` (`not_an_image` or `too_large`) for input it refuses.
 */

/**
 * Moderation for one processed photo. Phase 7 replaces the development adapter with the
 * `safety.contentChecks` pipeline.
 * @typedef {object} ContentCheck
 * @property {(input: { userId: string, kind: 'photo', objectKey: string, contentType: 'image/webp' }) => Promise<{ verdict: 'approve' | 'reject' | 'review', reasons: string[], provider: string }>} check
 */

/**
 * @typedef {object} MediaSettings
 * @property {number} photosMax
 * @property {number} uploadMaxBytes
 * @property {number} uploadUrlTtlSeconds
 * @property {string} cdnBaseUrl
 */

/**
 * Everything the media use cases receive.
 * @typedef {object} MediaDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<MediaStores>} uow
 * @property {<T>(fn: (stores: MediaStores) => Promise<T>) => Promise<T>} read
 * @property {StorageProvider} storage
 * @property {ImageProcessor} images
 * @property {ContentCheck} contentCheck
 * @property {MediaSettings} settings
 * @property {{ now: () => Date }} clock
 * @property {() => string} newId
 * @property {() => string} randomKey  16 random bytes, base64url.
 * @property {(tx: import('postgres').TransactionSql, key: string) => Promise<void>} lockKey
 * @property {import('pino').Logger} logger
 */

export {};
