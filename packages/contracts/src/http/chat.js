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
    'an opaque cursor: pass `nextAfterSeq` back as `afterSeq`. It is null on the last page. ' +
    'To load history backwards (a chat screen opens at the newest message), pass `beforeSeq` ' +
    'instead: the newest `limit` messages before it, in seq order, and `prevBeforeSeq` for the ' +
    'next older page (null at the start). `peerDeliveredSeq` and `peerReadSeq` are the other ' +
    'member’s cursors, for delivery and read states on your own messages.',
  params: z.strictObject({ id: ConversationId }),
  query: z.strictObject({
    afterSeq: z.coerce.number().int().min(0).default(0),
    beforeSeq: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Page backwards: messages with seq below this (Phase 13).'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: {
    status: 200,
    schema: z.strictObject({
      items: z.array(Message),
      nextAfterSeq: z.int().min(1).nullable(),
      prevBeforeSeq: z
        .int()
        .min(1)
        .nullable()
        .describe('With `beforeSeq`: pass back as `beforeSeq` for older messages (Phase 13).'),
      peerDeliveredSeq: z.int().min(0).describe('The other member’s delivered cursor (Phase 13).'),
      peerReadSeq: z
        .int()
        .min(0)
        .describe(
          'The other member’s read cursor (Phase 13). 0 unless both members share read ' +
            'receipts (Phase 14).',
        ),
    }),
  },
  errors: ['NOT_FOUND', 'NOT_A_MEMBER'],
});

/**
 * Chat privacy settings (Phase 14, owner). Read receipts are off by default and reciprocal:
 * you see the other person's read state only when both of you share it.
 */
export const ChatSettings = z.strictObject({
  shareReadReceipts: z
    .boolean()
    .describe('Off by default. Reciprocal: read states are shown only when both people share.'),
});

export const getChatSettings = defineEndpoint({
  id: 'getChatSettings',
  module: 'chat',
  method: 'GET',
  path: '/v1/me/chat-settings',
  auth: 'user',
  summary: 'Your chat privacy settings (defaults until first saved).',
  response: { status: 200, schema: ChatSettings },
});

export const putChatSettings = defineEndpoint({
  id: 'putChatSettings',
  module: 'chat',
  method: 'PUT',
  path: '/v1/me/chat-settings',
  auth: 'user',
  summary: 'Replace your chat privacy settings.',
  description:
    'Turning read receipts off stops yours being sent at once, and hides other people’s read ' +
    'state from you (reciprocal).',
  body: ChatSettings,
  response: { status: 200, schema: ChatSettings },
});

export const chatEndpoints = [listConversations, listMessages, getChatSettings, putChatSettings];
