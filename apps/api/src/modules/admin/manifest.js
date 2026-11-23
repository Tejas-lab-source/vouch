// @ts-check
import { defineModule } from '../../platform/registry.js';

const byContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!byContext.has(ctx)) {
    const { buildAdminDeps, buildAdminHandlers } = await import('./adapters/wiring.js');
    byContext.set(ctx, buildAdminHandlers(buildAdminDeps(ctx)));
  }
  return byContext.get(ctx);
}

export default defineModule({
  name: 'admin',
  version: 1,
  dependsOn: ['identity', 'profiles', 'safety'],
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { adminRoutes } = await import('./adapters/http/routes.js');
      return adminRoutes(await handlersOf(ctx));
    },
  },
  jobs: {
    queue: 'bulk',
    handlers: {
      'admin.retentionTick': async (/** @type {any} */ ctx) => {
        const { retention } = await handlersOf(ctx);
        return () => retention();
      },
    },
  },
  schedules: [{ id: 'admin.retention-tick', cron: '19 4 * * *', job: 'admin.retentionTick' }],
  admin: {
    panels: async () => (await import('./adapters/admin/panels.js')).adminPanels,
  },
  migrations: new URL('./migrations', import.meta.url),
});
