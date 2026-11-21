// @ts-check
import { z } from 'zod';
import { Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

export const deckServed = defineEvent({
  name: 'deck.served.v1',
  producer: 'discovery',
  description: 'Cards shown to a viewer (impression log for later learned ranking).',
  payload: z.strictObject({
    viewerId: Uuidv7,
    targetIds: z.array(Uuidv7).min(1).max(10),
    servedAt: Timestamp,
  }),
});

export const discoveryEvents = [deckServed];
