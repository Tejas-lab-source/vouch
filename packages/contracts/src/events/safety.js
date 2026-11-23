// @ts-check
import { z } from 'zod';
import { ReportContext, ReportReason } from '../common/codes.js';
import { Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

export const userBlocked = defineEvent({
  name: 'user.blocked.v1',
  producer: 'safety',
  description: 'One user blocked another. Decks, matches, chats and pushes react.',
  payload: z.strictObject({ blockerId: Uuidv7, blockedId: Uuidv7, blockedAt: Timestamp }),
});

export const reportCreated = defineEvent({
  name: 'report.created.v1',
  producer: 'safety',
  description: 'A report entered the moderation queue.',
  payload: z.strictObject({
    reportId: Uuidv7,
    reporterId: Uuidv7,
    targetId: Uuidv7,
    context: ReportContext,
    reason: ReportReason,
    createdAt: Timestamp,
  }),
});

export const userBanned = defineEvent({
  name: 'user.banned.v1',
  producer: 'safety',
  description: 'A user was banned. Identity revokes sessions; discovery and chat hide them.',
  payload: z.strictObject({
    userId: Uuidv7,
    banId: Uuidv7,
    expiresAt: Timestamp.nullable(),
    bannedAt: Timestamp,
  }),
});

export const userUnbanned = defineEvent({
  name: 'user.unbanned.v1',
  producer: 'safety',
  description: 'A ban was lifted or expired. Identity reactivates the account.',
  payload: z.strictObject({ userId: Uuidv7, banId: Uuidv7, liftedAt: Timestamp }),
});

export const verificationDecided = defineEvent({
  name: 'verification.decided.v1',
  producer: 'safety',
  description: 'An ID-card verification was approved or rejected. Identity updates the account.',
  payload: z.strictObject({
    userId: Uuidv7,
    reviewId: Uuidv7,
    decision: z.enum(['approved', 'rejected']),
    decidedAt: Timestamp,
  }),
});

export const safetyEvents = [
  userBlocked,
  reportCreated,
  userBanned,
  userUnbanned,
  verificationDecided,
];
