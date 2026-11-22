// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createDiscoveryApi } from './api.js';

const byContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!byContext.has(ctx)) {
    const { buildDiscoveryDeps, buildDiscoveryHandlers } = await import('./adapters/wiring.js');
    byContext.set(ctx, buildDiscoveryHandlers(buildDiscoveryDeps(ctx)));
  }
  return byContext.get(ctx);
}

/** @param {any} ctx @param {string} event */
async function handlerFor(ctx, event) {
  const { discoveryEventHandlers } = await import('./adapters/events/consumers.js');
  return discoveryEventHandlers((await handlersOf(ctx)).consumers).get(event);
}

export default defineModule({
  name: 'discovery',
  version: 1,
  dependsOn: ['identity', 'profiles', 'safety'],
  api: async (/** @type {any} */ ctx) => createDiscoveryApi(await handlersOf(ctx)),
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { discoveryRoutes } = await import('./adapters/http/routes.js');
      return discoveryRoutes(await handlersOf(ctx));
    },
  },
  subscribe: {
    'user.blocked.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'user.blocked.v1'),
    'match.created.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'match.created.v1'),
    'profile.updated.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'profile.updated.v1'),
    'photo.approved.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'photo.approved.v1'),
  },
  jobs: {
    queue: 'fast',
    handlers: {
      'discovery.buildDeck': async (/** @type {any} */ ctx) => {
        const { buildDeck } = await handlersOf(ctx);
        return (/** @type {{ data: { userId: string, reason: string } }} */ job) =>
          buildDeck(job.data);
      },
    },
  },
});
