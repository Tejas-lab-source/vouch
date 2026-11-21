// @ts-check
import { z } from 'zod';
import { ImageContentType } from '../common/codes.js';
import { Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

const ObjectKey = z.string().min(1).max(300);

export const photoUploaded = defineEvent({
  name: 'photo.uploaded.v1',
  producer: 'media',
  description: 'The client confirmed an upload. The media worker processes and moderates it.',
  payload: z.strictObject({
    uploadId: Uuidv7,
    userId: Uuidv7,
    rawKey: ObjectKey,
    contentType: ImageContentType,
    confirmedAt: Timestamp,
  }),
});

export const photoApproved = defineEvent({
  name: 'photo.approved.v1',
  producer: 'media',
  description: 'A processed photo passed moderation and is now visible.',
  payload: z.strictObject({
    photoId: Uuidv7,
    uploadId: Uuidv7,
    userId: Uuidv7,
    keys: z.strictObject({ w400: ObjectKey, w1080: ObjectKey }),
    approvedAt: Timestamp,
  }),
});

export const photoRejected = defineEvent({
  name: 'photo.rejected.v1',
  producer: 'media',
  description: 'A photo failed validation or moderation. Safety counts repeat offences.',
  payload: z.strictObject({
    photoId: Uuidv7.nullable().describe('Null when the upload failed before a photo existed.'),
    uploadId: Uuidv7,
    userId: Uuidv7,
    reason: z.enum(['not_an_image', 'too_large', 'moderation', 'processing_failed']),
    rejectedAt: Timestamp,
  }),
});

export const mediaEvents = [photoUploaded, photoApproved, photoRejected];
