// @ts-check
import { z } from 'zod';
import { MESSAGE_BODY, MessageKind } from '../common/codes.js';
import { Message, ProfileCard } from '../common/entities.js';
import { ErrorBody } from '../common/errors.js';
import { ClientMsgId, ConversationId, MatchId, Seq, Timestamp } from '../common/ids.js';

/**
 * Socket.IO contracts (WebSocket transport only). Sockets authenticate with the access JWT in
 * the handshake, ping every 25 s and re-authenticate after a token refresh. Event names follow
 * the event rule: a breaking change becomes `<name>.v2`.
 */

/** Failed ack: the same error body as the REST envelope. */
const AckError = z.strictObject({ ok: z.literal(false), error: ErrorBody });

/**
 * Builds an ack schema: `{ ok: true, ...success }` or `{ ok: false, error }`.
 * @template {z.core.$ZodLooseShape} T
 * @param {T} success
 */
function ack(success) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), ...success }),
    AckError,
  ]);
}

/** Client → server events, with their payload and (where defined) ack. */
export const CLIENT_EVENTS = Object.freeze({
  'message.send': {
    description:
      'Send a message. Idempotent on (conversationId, clientMsgId): a retry acks the original ' +
      'message. The ack is sent only after the message is committed.',
    payload: z.strictObject({
      conversationId: ConversationId,
      clientMsgId: ClientMsgId,
      kind: MessageKind,
      body: z.string().min(MESSAGE_BODY.MIN).max(MESSAGE_BODY.MAX),
    }),
    ack: ack({ clientMsgId: ClientMsgId, seq: Seq, createdAt: Timestamp }),
  },
  'message.read': {
    description: 'Advance the caller’s read cursor to `seq`. Cursors never move backwards.',
    payload: z.strictObject({ conversationId: ConversationId, seq: Seq }),
    ack: null,
  },
  'message.delivered': {
    description: 'Report that messages up to `seq` reached this device.',
    payload: z.strictObject({ conversationId: ConversationId, seq: Seq }),
    ack: null,
  },
  sync: {
    description:
      'After a (re)connect: send the last seq seen per conversation; the ack returns every ' +
      'missed message in seq order. `truncated` means call again with the new cursors.',
    payload: z.strictObject({
      cursors: z
        .array(z.strictObject({ conversationId: ConversationId, lastSeq: z.int().min(0) }))
        .max(200),
    }),
    ack: ack({ messages: z.array(Message).max(500), truncated: z.boolean() }),
  },
});

/** Server → client events. */
export const SERVER_EVENTS = Object.freeze({
  'message.new': {
    description:
      'A new message in one of the caller’s conversations. Reply with `message.delivered`.',
    payload: Message,
  },
  'match.new': {
    description: 'A new match; sent to both users.',
    payload: z.strictObject({
      matchId: MatchId,
      conversationId: ConversationId.nullable(),
      user: ProfileCard.describe('The other user.'),
    }),
  },
  'conversation.closed': {
    description: 'The conversation can no longer receive messages.',
    payload: z.strictObject({
      conversationId: ConversationId,
      reason: z.enum(['unmatched', 'blocked', 'banned', 'deleted']),
    }),
  },
  'config.changed': {
    description: 'Flags or limits changed; refetch `GET /v1/config`.',
    payload: z.strictObject({}),
  },
});
