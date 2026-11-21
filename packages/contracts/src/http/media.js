// @ts-check
import { z } from 'zod';
import { ImageContentType, MAX_UPLOAD_BYTES } from '../common/codes.js';
import { Timestamp, UploadId } from '../common/ids.js';
import { defineEndpoint, EmptyBody } from './endpoint.js';

export const createUpload = defineEndpoint({
  id: 'createUpload',
  module: 'media',
  method: 'POST',
  path: '/v1/media/uploads',
  auth: 'user',
  summary: 'Get a presigned URL to upload one photo straight to storage.',
  description:
    'Size and content type are fixed in the signature. Photo bytes never pass through the API.',
  body: z.strictObject({
    contentType: ImageContentType,
    sizeBytes: z.int().min(1).max(MAX_UPLOAD_BYTES),
  }),
  response: {
    status: 201,
    schema: z.strictObject({
      uploadId: UploadId,
      url: z.url({ protocol: /^https?$/ }),
      method: z.literal('PUT'),
      headers: z.record(z.string(), z.string()).describe('Headers the upload request must send.'),
      expiresAt: Timestamp,
    }),
  },
  errors: ['UNSUPPORTED_MEDIA_TYPE', 'FILE_TOO_LARGE', 'PHOTO_LIMIT_REACHED'],
});

export const confirmUpload = defineEndpoint({
  id: 'confirmUpload',
  module: 'media',
  method: 'POST',
  path: '/v1/media/uploads/{id}/confirm',
  auth: 'user',
  summary: 'Confirm an upload finished; processing and moderation start.',
  description: 'Idempotent on the upload id: confirming twice returns the same result.',
  idempotency: 'path',
  idempotencyField: 'id',
  params: z.strictObject({ id: UploadId }),
  body: EmptyBody,
  response: {
    status: 202,
    schema: z.strictObject({
      uploadId: UploadId,
      status: z.enum(['processing', 'approved', 'rejected']),
    }),
  },
  errors: ['NOT_FOUND', 'UPLOAD_NOT_UPLOADED'],
});

export const mediaEndpoints = [createUpload, confirmUpload];
