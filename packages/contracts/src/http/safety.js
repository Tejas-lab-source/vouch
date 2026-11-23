// @ts-check
import { z } from 'zod';
import { ReportContext, ReportReason } from '../common/codes.js';
import { ImageContentType, MAX_UPLOAD_BYTES } from '../common/codes.js';
import { ConversationId, PublicUserId, ReportId, Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEndpoint } from './endpoint.js';

export const blockUser = defineEndpoint({
  id: 'blockUser',
  module: 'safety',
  method: 'POST',
  path: '/v1/blocks',
  auth: 'user',
  summary: 'Block a user. Both users disappear from each other’s decks, matches and chats.',
  description: 'Idempotent on the target: blocking twice is a no-op with the same result.',
  idempotency: 'body',
  idempotencyField: 'targetId',
  body: z.strictObject({ targetId: PublicUserId }),
  response: { status: 200, schema: z.strictObject({ blocked: z.literal(true) }) },
  errors: ['NOT_FOUND'],
});

export const reportUser = defineEndpoint({
  id: 'reportUser',
  module: 'safety',
  method: 'POST',
  path: '/v1/reports',
  auth: 'user',
  summary: 'Report a user. An evidence snapshot is taken at report time.',
  description:
    'For `chat` reports, `conversationId` is required and the last 20 messages are kept as ' +
    'evidence. Reporting does not block; clients usually offer both.',
  body: z
    .strictObject({
      targetId: PublicUserId,
      context: ReportContext,
      reason: ReportReason,
      conversationId: ConversationId.optional(),
      note: z.string().max(500).optional(),
    })
    .refine(
      (body) => body.context !== 'chat' || body.conversationId !== undefined,
      'conversationId is required for chat reports',
    ),
  response: {
    status: 201,
    schema: z.strictObject({ reportId: ReportId, status: z.literal('open') }),
  },
  errors: ['NOT_FOUND', 'NOT_A_MEMBER'],
});

const ImageFile = z.strictObject({
  contentType: ImageContentType,
  sizeBytes: z.int().min(1).max(MAX_UPLOAD_BYTES),
});
const UploadTarget = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()).describe('Headers the upload request must send.'),
});

export const createIdCardUploads = defineEndpoint({
  id: 'createIdCardUploads',
  module: 'safety',
  method: 'POST',
  path: '/v1/verification/id-card/uploads',
  auth: 'user',
  summary: 'Presigned URLs for a student ID photo and a selfie (ID-card sign-up only).',
  description:
    'Only for accounts in `pending_review` without a submitted review. The images are private: ' +
    'they are never served by the CDN and are deleted 30 days after the decision.',
  body: z.strictObject({ idCard: ImageFile, selfie: ImageFile }),
  response: {
    status: 201,
    schema: z.strictObject({
      submissionId: Uuidv7,
      idCard: UploadTarget,
      selfie: UploadTarget,
      expiresAt: Timestamp,
    }),
  },
  errors: ['FORBIDDEN', 'CONFLICT', 'UNSUPPORTED_MEDIA_TYPE', 'FILE_TOO_LARGE'],
});

export const submitIdCard = defineEndpoint({
  id: 'submitIdCard',
  module: 'safety',
  method: 'POST',
  path: '/v1/verification/id-card',
  auth: 'user',
  summary: 'Submit the uploaded ID and selfie for review.',
  description: 'Idempotent on the submission id. The account stays `pending_review` until decided.',
  idempotency: 'body',
  idempotencyField: 'submissionId',
  body: z.strictObject({ submissionId: Uuidv7 }),
  response: { status: 201, schema: z.strictObject({ status: z.literal('pending') }) },
  errors: ['FORBIDDEN', 'CONFLICT', 'NOT_FOUND', 'UPLOAD_NOT_UPLOADED'],
});

/** Someone the caller blocked (Phase 13 settings). */
export const BlockedUser = z.strictObject({
  userId: PublicUserId,
  name: z.string().min(1).max(50).nullable().describe('Null when their profile is gone.'),
  blockedAt: Timestamp,
});

export const listMyBlocks = defineEndpoint({
  id: 'listMyBlocks',
  module: 'safety',
  method: 'GET',
  path: '/v1/me/blocks',
  auth: 'user',
  summary: 'The people you blocked, newest first.',
  description: 'Only your own blocks: who blocked you is never revealed.',
  response: { status: 200, schema: z.strictObject({ items: z.array(BlockedUser).max(1000) }) },
});

export const unblockUser = defineEndpoint({
  id: 'unblockUser',
  module: 'safety',
  method: 'DELETE',
  path: '/v1/blocks/{userId}',
  auth: 'user',
  summary: 'Remove your block on a user.',
  description:
    'Idempotent: unblocking someone not blocked returns `unblocked: false`. An ended match or ' +
    'closed conversation is not restored; you may see each other in decks again.',
  params: z.strictObject({ userId: PublicUserId }),
  response: { status: 200, schema: z.strictObject({ unblocked: z.boolean() }) },
});

export const safetyEndpoints = [
  blockUser,
  reportUser,
  createIdCardUploads,
  submitIdCard,
  listMyBlocks,
  unblockUser,
];
