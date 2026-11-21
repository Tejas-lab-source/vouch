// @ts-check
import { z } from 'zod';
import { Message, ProfileCard } from '../common/entities.js';
import { ConversationId, MatchId, Timestamp } from '../common/ids.js';
import { page, PageQuery } from '../common/pagination.js';
import { defineEndpoint } from './endpoint.js';

/** A conversation in the caller's inbox. */
export const ConversationSummary = z.strictObject({
  conversationId: ConversationId,
  matchId: MatchId,
  user: ProfileCard.describe('The other member.'),
  lastMessage: Message.nullable(),
  lastReadSeq: z.int().min(0),
  closed: z.boolean(),
  updatedAt: Timestamp,
});

export const listConversations = defineEndpoint({
  id: 'listConversations',
  module: 'chat',
  method: 'GET',
  path: '/v1/conversations',
  auth: 'user',
  summary: 'List the caller’s conversations, most recently active first.',
  query: PageQuery,
  response: { status: 200, schema: page(ConversationSummary) },
});

export const listMessages = defineEndpoint({
  id: 'listMessages',
  module: 'chat',
  method: 'GET',
  path: '/v1/conversations/{id}/messages',
  auth: 'user',
  summary: 'Message history and gap replay, in seq order.',
  description:
    'Messages are addressed by `(conversationId, seq)`, so this list pages by seq instead of ' +
    'an opaque cursor: pass `nextAfterSeq` back as `afterSeq`. It is null on the last page.',
  params: z.strictObject({ id: ConversationId }),
  query: z.strictObject({
    afterSeq: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: {
    status: 200,
    schema: z.strictObject({ items: z.array(Message), nextAfterSeq: z.int().min(1).nullable() }),
  },
  errors: ['NOT_FOUND', 'NOT_A_MEMBER'],
});

export const chatEndpoints = [listConversations, listMessages];
