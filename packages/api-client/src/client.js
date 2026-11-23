// @ts-check

/**
 * Endpoint metadata the client needs (generated from the contracts; no schemas, so no zod in
 * the bundle).
 * @typedef {object} EndpointMeta
 * @property {string} id
 * @property {'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} method
 * @property {string} path  With `{param}` placeholders.
 * @property {'public' | 'optional' | 'user' | 'admin'} auth
 * @property {'header' | 'body' | 'path' | 'none'} idempotency
 */

/**
 * @typedef {object} CallInput
 * @property {Record<string, string>} [params]
 * @property {Record<string, string | number | boolean | undefined>} [query]
 * @property {unknown} [body]
 * @property {AbortSignal} [signal]
 */

/**
 * A failed call: the error envelope's code and message, the HTTP status and the request id.
 * Network failures have code `NETWORK` and status 0.
 */
export class ApiError extends Error {
  /**
   * @param {{ code: string, message: string, status: number, requestId?: string | null, details?: Record<string, unknown> }} init
   */
  constructor({ code, message, status, requestId = null, details }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

/** Codes after which the access token is useless and a refresh may help. */
const REFRESHABLE = new Set(['UNAUTHENTICATED']);
/** Refresh outcomes after which the session is over. */
export const SESSION_OVER = new Set([
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSED',
  'ACCOUNT_BANNED',
]);

/**
 * Creates the API client.
 * - Sends `X-App-Version` on every call, and an `Idempotency-Key` for endpoints idempotent by
 *   header (one key per call, so a retry of the same call reuses it).
 * - Maps the error envelope to `ApiError`.
 * - On `UNAUTHENTICATED` for a signed-in call, refreshes once and retries. Concurrent 401s
 *   share one refresh (single flight). A failed refresh ends the session (`onSessionEnded`).
 * @param {{
 *   baseUrl: string,
 *   appVersion: string,
 *   fetch?: typeof fetch,
 *   tokens: { get: () => string | null | Promise<string | null>, refresh: () => Promise<string> },
 *   onSessionEnded?: (error: ApiError) => void,
 *   newKey?: () => string,
 *   credentials?: 'include' | 'omit' | 'same-origin',
 * }} options
 */
export function createApiClient({
  baseUrl,
  appVersion,
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
  tokens,
  onSessionEnded = () => {},
  newKey = () => /** @type {any} */ (globalThis).crypto.randomUUID(),
  credentials = 'same-origin',
}) {
  const base = baseUrl.replace(/\/+$/, '');
  /** @type {Promise<string> | null} */
  let refreshing = null;

  /** One refresh at a time: concurrent callers await the same promise. */
  function refreshOnce() {
    refreshing ??= tokens.refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** @param {string} path @param {Record<string, string> | undefined} params */
  const fillPath = (path, params = {}) =>
    path.replace(/\{(\w+)\}/g, (_m, name) => {
      const value = new Map(Object.entries(params)).get(name);
      if (value === undefined) throw new Error(`missing path parameter ${name}`);
      return encodeURIComponent(value);
    });

  /** @param {CallInput['query']} query */
  const queryString = (query = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : '';
  };

  /**
   * @param {Response} response
   * @returns {Promise<ApiError>}
   */
  async function toError(response) {
    const body = /** @type {any} */ (await response.json().catch(() => null));
    const envelope = body?.error;
    return new ApiError({
      code: typeof envelope?.code === 'string' ? envelope.code : 'INTERNAL',
      message: typeof envelope?.message === 'string' ? envelope.message : 'Something went wrong.',
      status: response.status,
      requestId: envelope?.requestId ?? response.headers.get('x-request-id'),
      details: envelope?.details,
    });
  }

  /**
   * Calls one endpoint.
   * @param {EndpointMeta} endpoint
   * @param {CallInput} [input]
   * @returns {Promise<any>}
   */
  async function call(endpoint, input = {}) {
    const url = `${base}${fillPath(endpoint.path, input.params)}${queryString(input.query)}`;
    const idempotencyKey = endpoint.idempotency === 'header' ? newKey() : null;
    const signedIn =
      endpoint.auth === 'user' || endpoint.auth === 'admin' || endpoint.auth === 'optional';

    /** @param {string | null} token */
    const send = async (token) => {
      /** @type {Record<string, string>} */
      const headers = { accept: 'application/json', 'x-app-version': appVersion };
      if (input.body !== undefined) headers['content-type'] = 'application/json';
      if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
      if (token) headers.authorization = `Bearer ${token}`;
      try {
        return await fetchImpl(url, {
          method: endpoint.method,
          headers,
          credentials,
          signal: input.signal,
          ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
        });
      } catch (cause) {
        if (/** @type {any} */ (cause)?.name === 'AbortError') throw cause;
        throw new ApiError({ code: 'NETWORK', message: 'You are offline.', status: 0 });
      }
    };

    const token = signedIn ? await tokens.get() : null;
    let response = await send(token);
    if (!response.ok && response.status === 401 && token && endpoint.auth !== 'public') {
      const error = await toError(response);
      if (!REFRESHABLE.has(error.code)) throw error;
      let fresh;
      try {
        fresh = await refreshOnce();
      } catch (refreshError) {
        const ended =
          refreshError instanceof ApiError
            ? refreshError
            : new ApiError({ code: 'UNAUTHENTICATED', message: 'Sign in again.', status: 401 });
        onSessionEnded(ended);
        throw ended;
      }
      response = await send(fresh);
    }
    if (!response.ok) throw await toError(response);
    if (response.status === 204) return null;
    return response.json();
  }

  return { call, refreshOnce };
}

/** @typedef {ReturnType<typeof createApiClient>} ApiClient */
