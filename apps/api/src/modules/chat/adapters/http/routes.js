// @ts-check
import { listConversations, listMessages } from '@vouch/contracts';
import { clientIpOf } from '../../../../platform/client-ip.js';
import { contractRoute } from '../../../../platform/routes.js';

/**
 * HTTP adapter for chat.
 * @param {{ listConversations: any, listMessages: any }} handlers
 */
export function chatRoutes(handlers) {
  /** @param {any} request */
  const ctx = (request) => ({ actor: request.user ?? null, ip: clientIpOf(request) });
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(listConversations, async (request) =>
        handlers.listConversations(request.query, ctx(request)),
      ),
    );
    app.route(
      contractRoute(listMessages, async (request) =>
        handlers.listMessages(
          { .../** @type {object} */ (request.query), .../** @type {object} */ (request.params) },
          ctx(request),
        ),
      ),
    );
  };
}
