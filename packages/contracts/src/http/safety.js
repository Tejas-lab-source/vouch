// @ts-check
import { z } from 'zod';
import { ReportContext, ReportReason } from '../common/codes.js';
import { ConversationId, PublicUserId, ReportId } from '../common/ids.js';
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

export const safetyEndpoints = [blockUser, reportUser];
