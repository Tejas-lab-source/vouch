// @ts-check
import { z } from 'zod';
import { Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

export const profileUpdated = defineEvent({
  name: 'profile.updated.v1',
  producer: 'profiles',
  description: 'A profile changed. Discovery refreshes eligibility and caches.',
  payload: z.strictObject({
    userId: Uuidv7,
    status: z.enum(['pending', 'active', 'hidden']),
    changed: z
      .array(
        z.enum([
          'name',
          'gender',
          'interestedIn',
          'bio',
          'ageRange',
          'photos',
          'sections',
          'status',
        ]),
      )
      .min(1),
    updatedAt: Timestamp,
  }),
});

export const profilesEvents = [profileUpdated];
