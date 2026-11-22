// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createProfilesApi } from './api.js';

/** One set of handlers per boot (the registry passes the same context to every hook). */
const byContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!byContext.has(ctx)) {
    const { buildProfilesDeps, buildProfilesHandlers } = await import('./adapters/wiring.js');
    byContext.set(ctx, buildProfilesHandlers(buildProfilesDeps(ctx)));
  }
  return byContext.get(ctx);
}

/** @param {any} ctx @param {string} event */
async function handlerFor(ctx, event) {
  const { profileEventHandlers } = await import('./adapters/events/consumers.js');
  return new Map(Object.entries(profileEventHandlers((await handlersOf(ctx)).consumers))).get(
    event,
  );
}

export default defineModule({
  name: 'profiles',
  version: 1,
  dependsOn: ['identity', 'media'],
  api: async (/** @type {any} */ ctx) => createProfilesApi((await handlersOf(ctx)).queries),
  exports: async (/** @type {any} */ ctx) => (await handlersOf(ctx)).queries.exportFor,
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { profilesRoutes } = await import('./adapters/http/routes.js');
      return profilesRoutes((await handlersOf(ctx)).useCases);
    },
  },
  subscribe: {
    'user.created.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'user.created.v1'),
    'user.deleted.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'user.deleted.v1'),
    'photo.uploaded.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'photo.uploaded.v1'),
    'photo.approved.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'photo.approved.v1'),
    'photo.rejected.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'photo.rejected.v1'),
  },
  migrations: new URL('./migrations', import.meta.url),
});
