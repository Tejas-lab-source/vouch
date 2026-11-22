// @ts-check
import {
  deleteAccount,
  exportData,
  listDevices,
  logout,
  refreshTokens,
  registerDevice,
  requestOtp,
  revokeDevice,
  verifyOtp,
} from '@vouch/contracts';
import { contractRoute } from '../../../../platform/routes.js';
import { clientIpOf } from '../../../../platform/client-ip.js';

export const REFRESH_COOKIE = 'vouch_refresh';

/** Cookie attributes for web refresh tokens (ADR 0011). */
const REFRESH_COOKIE_OPTIONS = /** @type {const} */ ({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/v1/auth/refresh',
});

/**
 * @typedef {object} IdentityHandlers
 * @property {import('../../../../platform/use-case.js').Handler} requestOtp
 * @property {import('../../../../platform/use-case.js').Handler} verifyOtp
 * @property {import('../../../../platform/use-case.js').Handler} refresh
 * @property {import('../../../../platform/use-case.js').Handler} logout
 * @property {import('../../../../platform/use-case.js').Handler} listDevices
 * @property {import('../../../../platform/use-case.js').Handler} revokeDevice
 * @property {import('../../../../platform/use-case.js').Handler} registerDevice
 * @property {import('../../../../platform/use-case.js').Handler} deleteAccount
 * @property {import('../../../../platform/use-case.js').Handler} exportData
 */

/**
 * The call context for a request: who is calling, from where, with which idempotency key.
 * @param {any} request
 * @returns {import('../../../../platform/use-case.js').CallContext}
 */
function contextOf(request) {
  const key = request.headers['idempotency-key'];
  return {
    actor: request.user ?? null,
    idempotencyKey: typeof key === 'string' ? key : undefined,
    ip: clientIpOf(request),
    refreshCookie: request.cookies?.vouch_refresh,
  };
}

/**
 * Returns tokens in the body (mobile) or sets the refresh token as a cookie (web).
 * @param {any} reply
 * @param {{ refreshToken: string, refreshTokenExpiresAt: string }} tokens
 * @param {'body' | 'cookie'} transport
 */
function deliverTokens(reply, tokens, transport) {
  if (transport !== 'cookie') return tokens;
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...REFRESH_COOKIE_OPTIONS,
    expires: new Date(tokens.refreshTokenExpiresAt),
  });
  const { refreshToken: _omitted, ...rest } = tokens;
  return rest;
}

/**
 * HTTP adapter for identity: thin mapping from contract routes to use cases.
 * @param {IdentityHandlers} handlers
 */
export function identityRoutes(handlers) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(requestOtp, async (request) =>
        handlers.requestOtp(request.body, contextOf(request)),
      ),
    );

    app.route(
      contractRoute(verifyOtp, async (request, reply) => {
        const body = /** @type {any} */ (request.body);
        const result = await handlers.verifyOtp(body, contextOf(request));
        return { ...result, tokens: deliverTokens(reply, result.tokens, body.tokenTransport) };
      }),
    );

    app.route(
      contractRoute(refreshTokens, async (request, reply) => {
        const body = /** @type {any} */ (request.body);
        const result = await handlers.refresh(body, contextOf(request));
        return { tokens: deliverTokens(reply, result.tokens, body.tokenTransport) };
      }),
    );

    app.route(
      contractRoute(logout, async (request, reply) => {
        const result = await handlers.logout({}, contextOf(request));
        reply.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
        return result;
      }),
    );

    app.route(
      contractRoute(listDevices, async (request) => handlers.listDevices({}, contextOf(request))),
    );
    app.route(
      contractRoute(revokeDevice, async (request) =>
        handlers.revokeDevice(request.params, contextOf(request)),
      ),
    );
    app.route(
      contractRoute(registerDevice, async (request) =>
        handlers.registerDevice(request.body, contextOf(request)),
      ),
    );

    app.route(
      contractRoute(deleteAccount, async (request, reply) => {
        const result = await handlers.deleteAccount({}, contextOf(request));
        reply.code(deleteAccount.response.status);
        return result;
      }),
    );

    app.route(
      contractRoute(exportData, async (request) => handlers.exportData({}, contextOf(request))),
    );
  };
}
