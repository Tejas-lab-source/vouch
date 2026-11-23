// @ts-check
import { z } from 'zod';
import { ProfileCard } from '../common/entities.js';
import { ConversationId, MatchId, PublicUserId, SwipeId, Timestamp } from '../common/ids.js';
import { page, PageQuery } from '../common/pagination.js';
import { defineEndpoint, EmptyBody } from './endpoint.js';

export const swipe = defineEndpoint({
  id: 'swipe',
  module: 'matching',
  method: 'POST',
  path: '/v1/swipes',
  auth: 'user',
  summary: 'Like or pass a card that was served in the deck.',
  description:
    'Idempotent on `swipeId`: a retry returns the original result. The target must have been ' +
    'served to the caller (NOT_SERVED otherwise). A mutual like creates exactly one match.',
  idempotency: 'body',
  idempotencyField: 'swipeId',
  body: z.strictObject({
    swipeId: SwipeId,
    targetId: PublicUserId,
    direction: z.enum(['like', 'pass']),
  }),
  response: {
    status: 200,
    schema: z.strictObject({ matched: z.boolean(), matchId: MatchId.nullable() }),
  },
  errors: ['NOT_SERVED', 'BLOCKED', 'PROFILE_INCOMPLETE'],
});

/** A match in the caller's match list. */
export const MatchSummary = z.strictObject({
  matchId: MatchId,
  conversationId: ConversationId.nullable().describe('Null until the conversation is opened.'),
  user: ProfileCard,
  createdAt: Timestamp,
});

export const listMatches = defineEndpoint({
  id: 'listMatches',
  module: 'matching',
  method: 'GET',
  path: '/v1/matches',
  auth: 'user',
  summary: 'List the caller’s active matches, newest first.',
  query: PageQuery,
  response: { status: 200, schema: page(MatchSummary) },
});

export const unmatch = defineEndpoint({
  id: 'unmatch',
  module: 'matching',
  method: 'POST',
  path: '/v1/matches/{id}/unmatch',
  auth: 'user',
  summary: 'Unmatch permanently; the conversation closes for both users.',
  description: 'Idempotent on the match id: unmatching twice returns the original result.',
  idempotency: 'path',
  idempotencyField: 'id',
  params: z.strictObject({ id: MatchId }),
  body: EmptyBody,
  response: { status: 200, schema: z.strictObject({ matchId: MatchId, unmatchedAt: Timestamp }) },
  errors: ['NOT_FOUND', 'NOT_MATCHED'],
});

export const getLikesCount = defineEndpoint({
  id: 'getLikesCount',
  module: 'matching',
  method: 'GET',
  path: '/v1/me/likes/count',
  auth: 'user',
  summary: 'How many people liked you and are still waiting for your swipe.',
  description:
    'A count only: who liked you is never returned. Blocked users are not counted. A pass made ' +
    'in the last few seconds may still be counted until it is written.',
  response: { status: 200, schema: z.strictObject({ count: z.int().min(0) }) },
});

export const matchingEndpoints = [swipe, listMatches, unmatch, getLikesCount];
