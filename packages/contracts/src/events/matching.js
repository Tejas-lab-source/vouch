// @ts-check
import { z } from 'zod';
import { Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

export const matchCreated = defineEvent({
  name: 'match.created.v1',
  producer: 'matching',
  description: 'A mutual like created a match (exactly once per pair).',
  payload: z.strictObject({
    matchId: Uuidv7,
    userLow: Uuidv7,
    userHigh: Uuidv7,
    firstLikerId: Uuidv7.describe('Notifications pushes to this user.'),
    createdAt: Timestamp,
  }),
});

export const matchUnmatched = defineEvent({
  name: 'match.unmatched.v1',
  producer: 'matching',
  description: 'A match ended permanently. Chat closes the conversation.',
  payload: z.strictObject({
    matchId: Uuidv7,
    userLow: Uuidv7,
    userHigh: Uuidv7,
    unmatchedBy: Uuidv7.nullable().describe('Null when ended by a block, ban or deletion.'),
    unmatchedAt: Timestamp,
  }),
});

export const matchingEvents = [matchCreated, matchUnmatched];
