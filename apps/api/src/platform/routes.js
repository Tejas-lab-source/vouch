// @ts-check

/**
 * The only signed-in routes an account waiting for ID-card review may call (Phase 10): the
 * verification upload, its own devices and session, deletion, export and the config.
 */
export const PENDING_REVIEW_ROUTES = new Set([
  'createIdCardUploads',
  'submitIdCard',
  'logout',
  'listDevices',
  'revokeDevice',
  'registerDevice',
  'deleteAccount',
  'exportData',
  'getConfig',
]);

/**
 * Fastify route options for a contract endpoint: method, path (`{id}` → `:id`), zod schemas for
 * params, query, headers, body and the success response, and `config.auth`. Responses are
 * serialised through the contract schema, so a route cannot return an unlisted field.
 * @param {import('@vouch/contracts').Endpoint} endpoint
 * @param {import('fastify').RouteHandlerMethod} handler
 * @returns {import('fastify').RouteOptions}
 */
export function contractRoute(endpoint, handler) {
  return {
    method: endpoint.method,
    url: endpoint.path.replace(/\{([a-zA-Z]+)\}/g, ':$1'),
    config: { auth: endpoint.auth, allowPendingReview: PENDING_REVIEW_ROUTES.has(endpoint.id) },
    schema: {
      ...(endpoint.params ? { params: endpoint.params } : {}),
      ...(endpoint.query ? { querystring: endpoint.query } : {}),
      ...(endpoint.body ? { body: endpoint.body } : {}),
      headers: endpoint.headers,
      response: { [endpoint.response.status]: endpoint.response.schema },
    },
    handler: /** @type {any} */ (handler),
  };
}
