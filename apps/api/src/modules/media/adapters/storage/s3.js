// @ts-check
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Network timeouts for every storage call (A.4). */
const CONNECT_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** S3 deletes at most 1,000 keys per request. */
const DELETE_BATCH = 1000;

/**
 * The only cross-origin access the bucket allows: browsers on the web origins may `PUT` a
 * presigned upload with the signed `content-type` (`content-length` is set by the browser).
 * Reads need no CORS rule (photos are plain `<img>` loads). The same rule is applied to R2 in
 * production (media README).
 * @param {readonly string[]} origins
 */
export const uploadCorsRule = (origins) => ({
  AllowedOrigins: [...origins],
  AllowedMethods: ['PUT'],
  AllowedHeaders: ['content-type'],
  MaxAgeSeconds: 3600,
});

/** @param {unknown} error */
const isNotFound = (error) =>
  /** @type {any} */ (error)?.$metadata?.httpStatusCode === 404 ||
  ['NotFound', 'NoSuchKey'].includes(/** @type {any} */ (error)?.name);

/**
 * `StorageProvider` on the S3 API: Cloudflare R2 in production, SeaweedFS locally (ADR 0012).
 * Checksums are only added when the operation requires them, because a default checksum
 * in a presigned URL is computed over an empty body and makes every upload fail.
 * @param {{
 *   endpoint?: string,
 *   accountId?: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   bucket: string,
 * }} options
 * @returns {import('../../ports.js').StorageProvider & { applyUploadCors: (origins: readonly string[]) => Promise<void> }}
 */
export function createS3Storage({ endpoint, accountId, accessKeyId, secretAccessKey, bucket }) {
  const client = new S3Client({
    region: 'auto',
    endpoint: endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
    requestHandler: { connectionTimeout: CONNECT_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
  });

  return {
    presignPut: ({ key, contentType, contentLength, expiresInSeconds }) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
        {
          expiresIn: expiresInSeconds,
          signableHeaders: new Set(['content-type', 'content-length']),
        },
      ),

    presignGet: ({ key, expiresInSeconds }) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      }),

    head: async (key) => {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { contentLength: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    read: async (key, maxBytes) => {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if ((object.ContentLength ?? 0) > maxBytes) throw new Error(`object larger than ${maxBytes}`);
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) throw new Error('object has no body');
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },

    write: async (key, body, { contentType, cacheControl }) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(cacheControl ? { CacheControl: cacheControl } : {}),
        }),
      );
    },

    remove: async (keys) => {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        const failed = (result.Errors ?? []).filter((e) => e.Code !== 'NoSuchKey');
        if (failed.length > 0) throw new Error(`failed to delete ${failed.length} objects`);
      }
    },

    ensureBucket: async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!isNotFound(error)) throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    },
    applyUploadCors: async (origins) => {
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: { CORSRules: [uploadCorsRule(origins)] },
        }),
      );
    },
  };
}
