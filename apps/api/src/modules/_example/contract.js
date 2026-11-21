// @ts-check
import { defineEvent } from '@vouch/contracts';
import { z } from 'zod';

/**
 * The example module's own contract. Real modules take theirs from `@vouch/contracts`; this
 * test-only module keeps its event and input schema here so production contracts stay clean.
 */
export const noteCreated = defineEvent({
  name: 'example.note_created.v1',
  producer: 'example',
  description: 'A note was created (test-only example module).',
  payload: z.strictObject({ noteId: z.uuidv7(), text: z.string().min(1).max(200) }),
});

export const CreateNoteInput = z.strictObject({ text: z.string().min(1).max(200) });
export const CreateNoteOutput = z.strictObject({ noteId: z.uuidv7() });

export const EXAMPLE_EVENTS = Object.freeze({ [noteCreated.name]: noteCreated });
