// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createMatchingApi } from './api.js';

const byContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!byContext.has(ctx)) {
    const { buildMatchingDeps, buildMatchingHandlers } = await import('./adapters/wiring.js');
    const deps = buildMatchingDeps(ctx);
    byContext.set(ctx, { deps, handlers: buildMatchingHandlers(deps, ctx) });
  }
  return byContext.get(ctx);
}

/** @param {any} ctx @param {string} event */
async function handlerFor(ctx, event) {
  const { matchingEventHandlers } = await import('./adapters/events/consumers.js');
  return matchingEventHandlers((await handlersOf(ctx)).handlers.consumers).get(event);
}

/** @param {any} ctx @param {(handlers: any) => (data: any) => Promise<unknown>} pick */
const job = (ctx, pick) =>
  handlersOf(ctx).then(
    ({ handlers }) =>
      (/** @type {{ data: any }} */ j) =>
        pick(handlers)(j.data),
  );

export default defineModule({
  name: 'matching',
  version: 1,
  dependsOn: ['identity', 'profiles', 'safety', 'discovery'],
  api: async (/** @type {any} */ ctx) => createMatchingApi((await handlersOf(ctx)).handlers),
  exports: async (/** @type {any} */ ctx) => (await handlersOf(ctx)).handlers.exportFor,
  contribute: {
    'discovery.candidateFilters': async (/** @type {any} */ ctx) => {
      const { excludeBufferedPasses } =
        await import('./adapters/pipeline/exclude-buffered-passes.js');
      return excludeBufferedPasses({ pendingFor: (await handlersOf(ctx)).deps.passes.pendingFor });
    },
  },
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { matchingRoutes } = await import('./adapters/http/routes.js');
      return matchingRoutes((await handlersOf(ctx)).handlers);
    },
  },
  subscribe: {
    'user.blocked.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'user.blocked.v1'),
    'user.deleted.v1': (/** @type {any} */ ctx) => handlerFor(ctx, 'user.deleted.v1'),
  },
  jobs: {
    queue: 'bulk',
    handlers: {
      'matching.flushPasses': (/** @type {any} */ ctx) =>
        job(ctx, (h) => () => h.batching.flushPasses()),
      'matching.writePasses': (/** @type {any} */ ctx) =>
        job(ctx, (h) => h.batching.writePassesBatch),
      'matching.retentionTick': (/** @type {any} */ ctx) =>
        job(ctx, (h) => () => h.retention.retentionTick()),
      'matching.purgePasses': (/** @type {any} */ ctx) => job(ctx, (h) => h.retention.purgePasses),
    },
  },
  schedules: [
    { id: 'matching.flush-passes', cron: '*/5 * * * * *', job: 'matching.flushPasses' },
    { id: 'matching.retention-tick', cron: '23 3 * * *', job: 'matching.retentionTick' },
  ],
  migrations: new URL('./migrations', import.meta.url),
});
