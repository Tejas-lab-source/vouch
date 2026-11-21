// @ts-check
import { makeCreateNote } from './application/create-note.js';

/**
 * Public API of the example module.
 * @param {import('./ports.js').ExampleDeps} deps
 */
export function createExampleApi(deps) {
  return { createNote: makeCreateNote(deps) };
}
