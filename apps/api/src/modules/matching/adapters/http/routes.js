// @ts-check
import { listMatches, swipe, unmatch } from '@vouch/contracts';
import { clientIpOf } from '../../../../platform/client-ip.js';
import { contractRoute } from '../../../../platform/routes.js';

/**
 * @param {any} request
 * @param {string} [idempotencyKey]
 * @returns {import('../../../../platform/use-case.js').CallContext}
 */
const contextOf = (request, idempotencyKey) => ({
  actor: request.user ?? null,
  idempotencyKey,
  ip: clientIpOf(request),
});

/**
 * HTTP adapter for matching.
 * @param {{ swipe: any, listMatches: any, unmatch: any }} handlers
 */
export function matchingRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(swipe, async (request) => {
        const body = /** @type {{ swipeId: string }} */ (request.body);
        // The contract makes `swipeId` the idempotency key (`idempotency: 'body'`).
        return handlers.swipe(request.body, contextOf(request, body.swipeId));
      }),
    );
    app.route(
      contractRoute(listMatches, async (request) =>
        handlers.listMatches(request.query, contextOf(request)),
      ),
    );
    app.route(
      contractRoute(unmatch, async (request) =>
        handlers.unmatch(request.params, contextOf(request)),
      ),
    );
  };
}
