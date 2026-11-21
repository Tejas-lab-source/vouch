// @ts-check
import { z } from 'zod';
import { IsoDate, PublicUserId, Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

export const userCreated = defineEvent({
  name: 'user.created.v1',
  producer: 'identity',
  description: 'A verified user signed up. Profiles creates the empty profile.',
  payload: z.strictObject({
    userId: Uuidv7,
    publicId: PublicUserId,
    collegeId: Uuidv7,
    clusterId: Uuidv7,
    birthDate: IsoDate.describe('Copied into profiles for age filtering.'),
    status: z.enum(['pending', 'pending_review', 'active']),
    createdAt: Timestamp,
  }),
});

export const userDeleted = defineEvent({
  name: 'user.deleted.v1',
  producer: 'identity',
  description: 'The user deleted their account. Every module erases or anonymises its data.',
  payload: z.strictObject({ userId: Uuidv7, deletedAt: Timestamp, eraseBy: Timestamp }),
});

export const identityEvents = [userCreated, userDeleted];
