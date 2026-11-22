// @ts-check
import { blockUser } from '@vouch/contracts';
import { contractRoute } from '../../../../platform/routes.js';

/**
 * HTTP adapter for safety (part 1: blocking).
 * @param {{ block: import('../../../../platform/use-case.js').Handler }} handlers
 */
export function safetyRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(blockUser, async (request) =>
        handlers.block(request.body, {
          actor: /** @type {any} */ (request).user ?? null,
          ip: request.ip,
        }),
      ),
    );
  };
}
