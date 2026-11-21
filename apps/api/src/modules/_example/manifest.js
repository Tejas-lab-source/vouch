// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createExampleApi } from './api.js';
import * as contract from './contract.js';

/**
 * @param {any} ctx  The registry context (platform services).
 * @returns {import('./ports.js').ExampleDeps}
 */
const depsFrom = (ctx) => ({
  useCase: ctx.useCase,
  uow: ctx.unitOfWork('example'),
  newId: ctx.newId,
  contract,
});

/**
 * Test-only module proving the kernel end to end: HTTP → use case → outbox → relay → consumer
 * → inbox. Never listed in `modules/index.js`. Expects `exampleSink` in the platform context.
 */
export default defineModule({
  name: 'example',
  version: 1,
  api: (/** @type {any} */ ctx) => createExampleApi(depsFrom(ctx)),
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { exampleRoutes } = await import('./adapters/http/routes.js');
      return exampleRoutes(createExampleApi(depsFrom(ctx)));
    },
  },
  subscribe: {
    'example.note_created.v1': async (/** @type {any} */ ctx) => {
      const { onNoteCreated } = await import('./adapters/events/on-note-created.js');
      return onNoteCreated(ctx.exampleSink);
    },
  },
});
