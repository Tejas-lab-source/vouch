// @ts-check

/**
 * What the example module needs from outside, injected by the registry.
 * @typedef {object} ExampleDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<{}>} uow
 * @property {() => string} newId
 * @property {typeof import('./contract.js')} contract  The module's event and input schemas.
 */

/**
 * Where the example consumer records what it saw (a test sink).
 * @typedef {object} NoteSink
 * @property {(entry: { noteId: string, text: string, traceId: string | null, eventId: number }) => void} record
 */

export {};
