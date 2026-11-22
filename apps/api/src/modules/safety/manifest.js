// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createSafetyApi } from './api.js';

const byContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!byContext.has(ctx)) {
    const { buildSafetyDeps, buildSafetyHandlers } = await import('./adapters/wiring.js');
    byContext.set(ctx, buildSafetyHandlers(buildSafetyDeps(ctx)));
  }
  return byContext.get(ctx);
}

export default defineModule({
  name: 'safety',
  version: 1,
  dependsOn: ['identity', 'media', 'profiles'],
  api: async (/** @type {any} */ ctx) => createSafetyApi(await handlersOf(ctx)),
  contribute: {
    'safety.contentChecks': async (/** @type {any} */ ctx) => (await handlersOf(ctx)).contentStep,
  },
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { safetyRoutes } = await import('./adapters/http/routes.js');
      return safetyRoutes(await handlersOf(ctx));
    },
  },
  subscribe: {
    'photo.rejected.v1': async (/** @type {any} */ ctx) => {
      const { onPhotoRejected } = await handlersOf(ctx);
      const { createSafetyStores } = await import('./adapters/pg/stores.js');
      return (/** @type {any} */ payload, /** @type {any} */ { tx, emit }) =>
        onPhotoRejected(payload, createSafetyStores(tx), emit);
    },
    'user.deleted.v1': async (/** @type {any} */ ctx) => (await handlersOf(ctx)).eraseUser,
  },
  jobs: {
    queue: 'bulk',
    handlers: {
      'safety.retentionTick': async (/** @type {any} */ ctx) => {
        const { retention } = await handlersOf(ctx);
        return () => retention();
      },
    },
  },
  schedules: [{ id: 'safety.retention-tick', cron: '7 4 * * *', job: 'safety.retentionTick' }],
  admin: {
    panels: async () => (await import('./adapters/admin/panels.js')).safetyPanels,
  },
  migrations: new URL('./migrations', import.meta.url),
});
