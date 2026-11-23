// @ts-check
import { makeNotificationConsumers } from '../application/consumers.js';
import { makePrefs } from '../application/prefs.js';
import { makePush } from '../application/push.js';
import { createAlertEmail } from './email/alerts.js';
import { createNotificationStores } from './pg/stores.js';
import { createExpoPush } from './push/expo.js';
import { createLogPush } from './push/log.js';

/**
 * @param {any} ctx  Registry context; optional `overrides.notifications.{push,email}`.
 * @returns {import('../ports.js').NotificationDeps}
 */
export function buildNotificationDeps(ctx) {
  const { config, db, redis, clock, logger, jobs } = ctx;
  const log = logger.child({ module: 'notifications' });
  const overrides = ctx.overrides?.notifications ?? {};
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('notifications', createNotificationStores),
    read: (fn) =>
      db.read('notifications', (/** @type {any} */ tx) => fn(createNotificationStores(tx))),
    storesFor: createNotificationStores,
    push:
      overrides.push ??
      (config.PUSH_PROVIDER === 'expo'
        ? createExpoPush({ accessToken: config.EXPO_ACCESS_TOKEN })
        : createLogPush({ logger: log })),
    email:
      overrides.email ??
      createAlertEmail({
        provider: config.EMAIL_PROVIDER,
        apiKey: config.RESEND_API_KEY,
        from: config.EMAIL_FROM,
        logger: log,
      }),
    templates: ctx.templates,
    identity: ctx.deps.identity,
    chat: ctx.deps.chat,
    matching: ctx.deps.matching,
    jobs,
    redis: redis.command,
    settings: {
      messageBatchSeconds: config.PUSH_MESSAGE_BATCH_SECONDS,
      alertEmail: config.ADMIN_ALERT_EMAIL ?? null,
    },
    clock,
    newId: ctx.newId,
    logger: log,
    metrics: ctx.metrics,
  };
}

/** @param {import('../ports.js').NotificationDeps} deps */
export function buildNotificationHandlers(deps) {
  const push = makePush(deps);
  const helpers = { ...deps, ...push };
  return {
    ...push,
    ...makePrefs(helpers),
    consumers: makeNotificationConsumers(helpers),
  };
}
