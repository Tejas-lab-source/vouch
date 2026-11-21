// @ts-check
import { z } from 'zod';
import { ProfileCard } from '../common/entities.js';
import { defineEndpoint } from './endpoint.js';

export const getDeck = defineEndpoint({
  id: 'getDeck',
  module: 'discovery',
  method: 'GET',
  path: '/v1/deck',
  auth: 'user',
  summary: 'Next cards from the user’s campus cluster (up to 10).',
  description:
    'Cards come from a precomputed deck. Blocked, matched and deleted users are dropped at ' +
    'read time. An empty list means no eligible candidates right now.',
  response: { status: 200, schema: z.strictObject({ cards: z.array(ProfileCard).max(10) }) },
  errors: ['PROFILE_INCOMPLETE'],
});

export const discoveryEndpoints = [getDeck];
