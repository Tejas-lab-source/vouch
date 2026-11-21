// @ts-check
import { normaliseNote } from '../domain/note.js';

/**
 * Use case: creates a note and emits `example.note_created.v1` in the same transaction.
 * @param {import('../ports.js').ExampleDeps} deps
 */
export function makeCreateNote({ useCase, uow, newId, contract }) {
  return useCase(
    'example.createNote',
    /** @param {{ text: string }} input */
    async (input) =>
      uow.run(async ({ emit }) => {
        const noteId = newId();
        await emit(contract.noteCreated, { noteId, text: normaliseNote(input.text) });
        return { noteId };
      }),
    { authz: 'public', input: contract.CreateNoteInput, idempotent: true },
  );
}
