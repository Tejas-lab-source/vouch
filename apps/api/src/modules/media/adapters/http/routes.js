// @ts-check
import { confirmUpload, createUpload } from '@vouch/contracts';
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
 * HTTP adapter for media.
 * @param {ReturnType<typeof import('../../application/uploads.js').makeUploadUseCases>} handlers
 */
export function mediaRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(createUpload, async (request, reply) => {
        const result = await handlers.createUpload(request.body, contextOf(request));
        reply.code(createUpload.response.status);
        return result;
      }),
    );
    app.route(
      contractRoute(confirmUpload, async (request, reply) => {
        const result = await handlers.confirmUpload(request.params, contextOf(request));
        reply.code(confirmUpload.response.status);
        return result;
      }),
    );
  };
}
