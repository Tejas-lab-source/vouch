// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createChatApi } from './api.js';

const byContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!byContext.has(ctx)) {
    const { buildChatDeps, buildChatHandlers } = await import('./adapters/wiring.js');
    byContext.set(ctx, buildChatHandlers(buildChatDeps(ctx)));
  }
  return byContext.get(ctx);
}

/** @param {any} ctx @param {string} event */
async function handlerFor(ctx, event) {
  const { chatEventHandlers } = await import('./adapters/events/consumers.js');
  return chatEventHandlers((await handlersOf(ctx)).consumers).get(event);
}

export default defineModule({
  name: 'chat',
  version: 1,
  dependsOn: ['identity', 'profiles', 'safety', 'matching'],
  api: async (/** @type {any} */ ctx) => createChatApi(await handlersOf(ctx)),
  exports: async (/** @type {any} */ ctx) => (await handlersOf(ctx)).exportFor,
  contribute: {
    'safety.reportEvidence': async (/** @type {any} */ ctx) =>
      (await handlersOf(ctx)).reportEvidence,
  },
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { chatRoutes } = await import('./adapters/http/routes.js');
      return chatRoutes(await handlersOf(ctx));
    },
  },
  socket: {
    handlers: async (/** @type {any} */ ctx) => {
      const { chatSocketHandlers } = await import('./adapters/socket/handlers.js');
      return chatSocketHandlers(await handlersOf(ctx));
    },
  },
  subscribe: {
    'match.created.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'match.created.v1'),
    'match.unmatched.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'match.unmatched.v1'),
    'user.blocked.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'user.blocked.v1'),
    'user.deleted.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'user.deleted.v1'),
  },
  jobs: {
    queue: 'bulk',
    handlers: {
      'chat.retentionTick': async (/** @type {any} */ ctx) => {
        const { purgeClosed } = await handlersOf(ctx);
        return () => purgeClosed();
      },
    },
  },
  schedules: [{ id: 'chat.retention-tick', cron: '31 3 * * *', job: 'chat.retentionTick' }],
  migrations: new URL('./migrations', import.meta.url),
});
