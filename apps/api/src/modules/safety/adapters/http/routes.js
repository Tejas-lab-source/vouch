// @ts-check
import { blockUser, createIdCardUploads, reportUser, submitIdCard } from '@vouch/contracts';
import { contractRoute } from '../../../../platform/routes.js';
import { clientIpOf } from '../../../../platform/client-ip.js';

/**
 * @param {any} request
 * @returns {import('../../../../platform/use-case.js').CallContext}
 */
function contextOf(request) {
  const key = request.headers['idempotency-key'];
  return {
    actor: request.user ?? null,
    idempotencyKey: typeof key === 'string' ? key : undefined,
    ip: clientIpOf(request),
  };
}

/**
 * HTTP adapter for safety: blocking (Phase 7), reports and the ID-card fallback (Phase 10).
 * @param {Record<'block' | 'report' | 'createIdCardUploads' | 'submitIdCard', import('../../../../platform/use-case.js').Handler>} handlers
 */
export function safetyRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(blockUser, async (request) => handlers.block(request.body, contextOf(request))),
    );
    for (const [endpoint, handler] of /** @type {const} */ ([
      [reportUser, handlers.report],
      [createIdCardUploads, handlers.createIdCardUploads],
      [submitIdCard, handlers.submitIdCard],
    ])) {
      app.route(
        contractRoute(endpoint, async (request, reply) => {
          const result = await handler(request.body, contextOf(request));
          reply.code(endpoint.response.status);
          return result;
        }),
      );
    }
  };
}
