// @ts-check
import {
  actOnReport,
  adminLogin,
  adminLogout,
  createBan,
  decidePhoto,
  decideVerification,
  getReport,
  getUser,
  liftBan,
  listAuditLog,
  listBans,
  listFlags,
  listOverdueDeletions,
  listPanels,
  listPhotoReviews,
  listReports,
  listVerificationReviews,
  putFlag,
  unblockUsers,
} from '@vouch/contracts';
import { clientIpOf } from '../../../../platform/client-ip.js';
import { contractRoute } from '../../../../platform/routes.js';

/**
 * @param {any} request
 * @returns {import('../../../../platform/use-case.js').CallContext & { requestId: string }}
 */
function contextOf(request) {
  const key = request.headers['idempotency-key'];
  return {
    actor: request.user ?? null,
    idempotencyKey: typeof key === 'string' ? key : undefined,
    ip: clientIpOf(request),
    requestId: String(request.id),
  };
}

/**
 * HTTP adapter for admin: every route in the admin contracts. The platform's auth hook already
 * required a `vouch:admin` token and the IP allowlist (auth `admin`); the use cases add MFA,
 * the active-account check and roles.
 * @param {ReturnType<typeof import('../../application/admin.js').makeAdmin>} h
 */
export function adminRoutes(h) {
  /** @type {[any, (request: any) => unknown, Function][]} */
  const table = [
    [adminLogin, (r) => r.body, h.login],
    [adminLogout, () => ({}), h.logout],
    [listPanels, () => ({}), h.listPanels],
    [listOverdueDeletions, () => ({}), h.listOverdueDeletions],
    [unblockUsers, (r) => ({ ...r.params, ...r.body }), h.unblock],
    [listReports, (r) => r.query, h.listReports],
    [getReport, (r) => r.params, h.getReport],
    [actOnReport, (r) => ({ ...r.params, ...r.body }), h.actOnReport],
    [listPhotoReviews, (r) => r.query, h.listPhotoReviews],
    [decidePhoto, (r) => ({ ...r.params, ...r.body }), h.decidePhoto],
    [listVerificationReviews, (r) => r.query, h.listVerificationReviews],
    [decideVerification, (r) => ({ ...r.params, ...r.body }), h.decideVerification],
    [getUser, (r) => r.params, h.getUser],
    [listBans, (r) => r.query, h.listBans],
    [createBan, (r) => r.body, h.createBan],
    [liftBan, (r) => r.params, h.liftBan],
    [listAuditLog, (r) => r.query, h.listAuditLog],
    [listFlags, () => ({}), h.listFlags],
    [putFlag, (r) => ({ ...r.params, ...r.body }), h.putFlag],
  ];
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    for (const [endpoint, inputOf, handler] of table) {
      app.route(
        contractRoute(endpoint, async (request, reply) => {
          const result = await handler(inputOf(request), contextOf(request));
          reply.code(endpoint.response.status);
          return result;
        }),
      );
    }
  };
}
