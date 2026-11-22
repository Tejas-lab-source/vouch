// @ts-check
import {
  deleteMyPhoto,
  getMyProfile,
  putProfileSection,
  reorderMyPhotos,
  updateMyProfile,
} from '@vouch/contracts';
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
 * HTTP adapter for profiles.
 * @param {ReturnType<typeof import('../../application/profile.js').makeProfileUseCases>} handlers
 */
export function profilesRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(getMyProfile, async (request) => handlers.getMyProfile({}, contextOf(request))),
    );
    app.route(
      contractRoute(updateMyProfile, async (request) =>
        handlers.updateMyProfile(request.body, contextOf(request)),
      ),
    );
    app.route(
      contractRoute(putProfileSection, async (request) => {
        const params = /** @type {{ type: string }} */ (request.params);
        const body = /** @type {object} */ (request.body);
        return handlers.putSection({ ...body, type: params.type }, contextOf(request));
      }),
    );
    app.route(
      contractRoute(deleteMyPhoto, async (request) =>
        handlers.deleteMyPhoto(request.params, contextOf(request)),
      ),
    );
    app.route(
      contractRoute(reorderMyPhotos, async (request) =>
        handlers.reorderMyPhotos(request.body, contextOf(request)),
      ),
    );
  };
}
