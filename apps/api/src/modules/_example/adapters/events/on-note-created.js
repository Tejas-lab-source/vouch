// @ts-check

/**
 * Consumer of `example.note_created.v1`: records the note in the injected sink.
 * Runs after the inbox insert, in the same transaction.
 * @param {import('../../ports.js').NoteSink} sink
 * @returns {import('../../../../platform/events/consume.js').EventHandler}
 */
export function onNoteCreated(sink) {
  return async (payload, { traceId, eventId }) => {
    sink.record({ noteId: payload.noteId, text: payload.text, traceId, eventId });
  };
}
