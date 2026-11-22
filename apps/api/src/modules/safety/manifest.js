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
  dependsOn: ['identity'],
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
  migrations: new URL('./migrations', import.meta.url),
});
