// @ts-check
import { getNotificationPrefs, putNotificationPrefs } from '@vouch/contracts';
import { clientIpOf } from '../../../../platform/client-ip.js';
import { contractRoute } from '../../../../platform/routes.js';

/**
 * HTTP adapter for notifications.
 * @param {{ putPrefs: import('../../../../platform/use-case.js').Handler, getPrefs: import('../../../../platform/use-case.js').Handler }} handlers
 */
export function notificationRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(getNotificationPrefs, async (request) =>
        handlers.getPrefs(
          {},
          {
            actor: /** @type {any} */ (request).user ?? null,
            ip: clientIpOf(request),
          },
        ),
      ),
    );
    app.route(
      contractRoute(putNotificationPrefs, async (request) =>
        handlers.putPrefs(request.body, {
          actor: /** @type {any} */ (request).user ?? null,
          ip: clientIpOf(request),
        }),
      ),
    );
  };
}
