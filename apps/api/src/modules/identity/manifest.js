// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createIdentityApi } from './api.js';

/** One set of dependencies per boot (the registry passes the same context to every hook). */
const depsByContext = new WeakMap();

/** @param {any} ctx */
async function depsOf(ctx) {
  if (!depsByContext.has(ctx)) {
    const { buildIdentityDeps } = await import('./adapters/wiring.js');
    depsByContext.set(ctx, buildIdentityDeps(ctx));
  }
  return depsByContext.get(ctx);
}

export default defineModule({
  name: 'identity',
  version: 1,
  dependsOn: [],
  api: async (/** @type {any} */ ctx) => createIdentityApi(await depsOf(ctx)),
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const [{ buildIdentityHandlers }, { identityRoutes }] = await Promise.all([
        import('./adapters/wiring.js'),
        import('./adapters/http/routes.js'),
      ]);
      return identityRoutes(buildIdentityHandlers(await depsOf(ctx)));
    },
  },
  subscribe: {
    'user.banned.v1': async (/** @type {any} */ ctx) => {
      const { onUserBanned } = await import('./adapters/events/on-user-banned.js');
      return onUserBanned({ clock: ctx.clock });
    },
    'user.unbanned.v1': async () => {
      const { onUserUnbanned } = await import('./adapters/events/on-user-banned.js');
      return onUserUnbanned();
    },
    'verification.decided.v1': async () => {
      const { onVerificationDecided } = await import('./adapters/events/on-user-banned.js');
      return onVerificationDecided();
    },
  },
  jobs: {
    queue: 'bulk',
    handlers: {
      'identity.retentionTick': async (/** @type {any} */ ctx) => {
        const { identityJobs } = await import('./adapters/jobs/retention.js');
        return identityJobs(ctx)['identity.retentionTick'];
      },
      'identity.retention': async (/** @type {any} */ ctx) => {
        const { identityJobs } = await import('./adapters/jobs/retention.js');
        return identityJobs(ctx)['identity.retention'];
      },
    },
  },
  schedules: [{ id: 'identity.retention-tick', cron: '41 3 * * *', job: 'identity.retentionTick' }],
  migrations: new URL('./migrations', import.meta.url),
});
