// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createMediaApi } from './api.js';

/** One set of dependencies per boot (the registry passes the same context to every hook). */
const depsByContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!depsByContext.has(ctx)) {
    const { buildMediaDeps, buildMediaHandlers } = await import('./adapters/wiring.js');
    const deps = buildMediaDeps(ctx);
    depsByContext.set(ctx, { deps, handlers: buildMediaHandlers(deps) });
  }
  return depsByContext.get(ctx);
}

export default defineModule({
  name: 'media',
  version: 1,
  dependsOn: [],
  api: async (/** @type {any} */ ctx) => createMediaApi((await handlersOf(ctx)).deps),
  exports: async (/** @type {any} */ ctx) => {
    const { makeMediaExport } = await import('./application/export.js');
    return makeMediaExport((await handlersOf(ctx)).deps);
  },
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { mediaRoutes } = await import('./adapters/http/routes.js');
      return mediaRoutes((await handlersOf(ctx)).handlers);
    },
  },
  subscribe: {
    'photo.uploaded.v1': async (/** @type {any} */ ctx) => {
      const { onPhotoUploaded } = await import('./adapters/events/consumers.js');
      return onPhotoUploaded({ jobs: ctx.jobs });
    },
    'user.deleted.v1': async (/** @type {any} */ ctx) => {
      const { onUserDeleted } = await import('./adapters/events/consumers.js');
      return onUserDeleted({ eraseUser: (await handlersOf(ctx)).handlers.release.eraseUser });
    },
  },
  jobs: {
    queue: 'media',
    handlers: {
      'media.processImage': async (/** @type {any} */ ctx) => {
        const { processImageJob } = await import('./adapters/jobs/process-image.js');
        const { deps, handlers } = await handlersOf(ctx);
        return processImageJob({ processing: handlers.processing, logger: deps.logger });
      },
      'media.retentionTick': async (/** @type {any} */ ctx) => {
        const { handlers } = await handlersOf(ctx);
        return () => handlers.purgeUploads();
      },
      'media.reviewAlert': async (/** @type {any} */ ctx) => {
        const { makeReview } = await import('./application/review.js');
        const review = makeReview((await handlersOf(ctx)).deps);
        return () => review.reviewAlert();
      },
    },
  },
  schedules: [
    { id: 'media.retention-tick', cron: '53 3 * * *', job: 'media.retentionTick' },
    { id: 'media.review-alert', cron: '17 * * * *', job: 'media.reviewAlert' },
  ],
  migrations: new URL('./migrations', import.meta.url),
});
