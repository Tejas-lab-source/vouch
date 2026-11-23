// @ts-check
import {
  getChatSettings,
  listConversations,
  listMessages,
  putChatSettings,
} from '@vouch/contracts';
import { clientIpOf } from '../../../../platform/client-ip.js';
import { contractRoute } from '../../../../platform/routes.js';

/**
 * HTTP adapter for chat.
 * @param {{ listConversations: any, listMessages: any, getChatSettings: any, putChatSettings: any }} handlers
 */
export function chatRoutes(handlers) {
  /** @param {any} request */
  const ctx = (request) => ({ actor: request.user ?? null, ip: clientIpOf(request) });
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(getChatSettings, async (request) => handlers.getChatSettings({}, ctx(request))),
    );
    app.route(
      contractRoute(putChatSettings, async (request) =>
        handlers.putChatSettings(request.body, ctx(request)),
      ),
    );
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
