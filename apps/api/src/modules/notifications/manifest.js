// @ts-check
import { defineModule } from '../../platform/registry.js';
import { createNotificationsApi } from './api.js';
import { V1_TEMPLATES } from './domain/templates.js';

const byContext = new WeakMap();

/** @param {any} ctx */
async function handlersOf(ctx) {
  if (!byContext.has(ctx)) {
    const { buildNotificationDeps, buildNotificationHandlers } =
      await import('./adapters/wiring.js');
    byContext.set(ctx, buildNotificationHandlers(buildNotificationDeps(ctx)));
  }
  return byContext.get(ctx);
}

/** @param {(c: any) => (payload: any, context: any) => Promise<void>} pick */
const consumer = (pick) => async (/** @type {any} */ ctx) => {
  const handler = pick((await handlersOf(ctx)).consumers);
  return (/** @type {any} */ payload, /** @type {any} */ context) => handler(payload, context);
};

export default defineModule({
  name: 'notifications',
  version: 1,
  dependsOn: ['identity', 'chat', 'matching'],
  api: async (/** @type {any} */ ctx) => createNotificationsApi(await handlersOf(ctx)),
  exports: async (/** @type {any} */ ctx) => (await handlersOf(ctx)).exportFor,
  templates: Object.fromEntries(V1_TEMPLATES.map((t) => [t.name, async () => t])),
  http: {
    routes: async (/** @type {any} */ ctx) => {
      const { notificationRoutes } = await import('./adapters/http/routes.js');
      return notificationRoutes(await handlersOf(ctx));
    },
  },
  subscribe: {
    'match.created.v1': consumer((c) => c.onMatchCreated),
    'message.created.v1': consumer((c) => c.onMessageCreated),
    'user.blocked.v1': consumer((c) => c.onUserBlocked),
    'report.created.v1': consumer((c) => c.onReportCreated),
    'user.deleted.v1': consumer((c) => c.onUserDeleted),
  },
  jobs: {
    queue: 'external',
    handlers: {
      'notifications.sendPush': async (/** @type {any} */ ctx) => {
        const { send } = await handlersOf(ctx);
        return (/** @type {any} */ job) => send(job.data);
      },
      'notifications.checkReceipts': async (/** @type {any} */ ctx) => {
        const { checkReceipts } = await handlersOf(ctx);
        return (/** @type {any} */ job) => checkReceipts(job.data);
      },
      'notifications.likesDigest': async (/** @type {any} */ ctx) => {
        const { likesDigest } = await handlersOf(ctx);
        return () => likesDigest();
      },
      'notifications.retentionTick': async (/** @type {any} */ ctx) => {
        const { retention } = await handlersOf(ctx);
        return () => retention();
      },
    },
  },
  schedules: [
    // 18:23 IST (12:53 UTC): an evening digest, away from quiet hours.
    { id: 'notifications.likes-digest', cron: '53 12 * * *', job: 'notifications.likesDigest' },
    { id: 'notifications.retention-tick', cron: '13 4 * * *', job: 'notifications.retentionTick' },
  ],
  migrations: new URL('./migrations', import.meta.url),
});
