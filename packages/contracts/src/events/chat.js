// @ts-check
import { z } from 'zod';
import { MessageKind } from '../common/codes.js';
import { Seq, Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

export const messageCreated = defineEvent({
  name: 'message.created.v1',
  producer: 'chat',
  description:
    'A message was stored for an offline recipient, so notifications can push. Never carries ' +
    'the message body.',
  payload: z.strictObject({
    conversationId: Uuidv7,
    seq: Seq,
    senderId: Uuidv7,
    recipientId: Uuidv7,
    kind: MessageKind,
    createdAt: Timestamp,
  }),
});

export const chatEvents = [messageCreated];
