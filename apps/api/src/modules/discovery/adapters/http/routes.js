// @ts-check
import { getDeck } from '@vouch/contracts';
import { contractRoute } from '../../../../platform/routes.js';

/**
 * HTTP adapter for discovery.
 * @param {{ getDeck: import('../../../../platform/use-case.js').Handler }} handlers
 */
export function discoveryRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(getDeck, async (request) =>
        handlers.getDeck({}, { actor: /** @type {any} */ (request).user ?? null, ip: request.ip }),
      ),
    );
  };
}
