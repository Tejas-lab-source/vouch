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
  'auth.refresh': {
    description:
      'After refreshing the access token, send the new one: the socket stays connected and its ' +
      'expiry moves to the new token’s (Phase 9). It must belong to the same user.',
    payload: z.strictObject({ token: z.string().min(1).max(4096) }),
    ack: ack({ expiresAt: Timestamp }),
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
  'receipt.updated': {
    description:
      'The other member’s delivered or read cursor moved (Phase 13): your messages up to ' +
      '`deliveredSeq` reached their device, and up to `readSeq` were read. Cursors only.',
    payload: z.strictObject({
      conversationId: ConversationId,
      deliveredSeq: z.int().min(0),
      readSeq: z.int().min(0),
    }),
  },
  'conversation.closed': {
    description: 'The conversation can no longer receive messages.',
    payload: z.strictObject({
      conversationId: ConversationId,
      reason: z.enum(['unmatched', 'blocked', 'banned', 'deleted']),
    }),
  },
  'auth.expired': {
    description:
      'The access token expired and no valid `auth.refresh` arrived within the grace period; ' +
      'the server disconnects next. Reconnect with a fresh token, then `sync` (Phase 9).',
    payload: z.strictObject({ reason: z.literal('token_expired') }),
  },
  'config.changed': {
    description: 'Flags or limits changed; refetch `GET /v1/config`.',
    payload: z.strictObject({}),
  },
});
