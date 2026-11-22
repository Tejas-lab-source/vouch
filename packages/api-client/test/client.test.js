// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  createSession,
  createSessionClient,
  ENDPOINTS,
  getConfig,
  keys,
  putNotificationPrefs,
  reportUser,
} from '../src/index.js';

/**
 * A fake API: `routes` maps "METHOD /path" to a handler returning [status, body].
 * @param {Record<string, (req: { headers: Record<string, string>, body: any }) => [number, unknown]>} routes
 */
function fakeFetch(routes) {
  /** @type {{ method: string, path: string, headers: Record<string, string>, body: any }[]} */
  const calls = [];
  const impl = /** @type {any} */ (
    vi.fn(async (/** @type {string} */ url, /** @type {any} */ init) => {
      const path = new URL(url).pathname + new URL(url).search;
      const headers = init.headers;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, path, headers, body });
      const handler = new Map(Object.entries(routes)).get(
        `${init.method} ${new URL(url).pathname}`,
      );
      const [status, payload] = handler
        ? handler({ headers, body })
        : [404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }];
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(payload === null ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
  return { impl, calls };
}

const BASE = 'https://api.test';

describe('api client', () => {
  it('generated functions cover every contract endpoint', () => {
    expect(Object.keys(ENDPOINTS)).toHaveLength(45);
    expect(ENDPOINTS.reportUser).toEqual({
      id: 'reportUser',
      method: 'POST',
      path: '/v1/reports',
      auth: 'user',
      idempotency: 'header',
    });
  });

  it('sends X-App-Version, an Idempotency-Key for header-idempotent endpoints, and fills paths and queries', async () => {
    const { impl, calls } = fakeFetch({
      'POST /v1/reports': () => [201, { reportId: 'r1', status: 'open' }],
      'GET /v1/config': () => [200, { flags: {} }],
      'PUT /v1/me/notification-prefs': ({ body }) => [200, body],
    });
    const client = createApiClient({
      baseUrl: `${BASE}/`,
      appVersion: '1.2.3',
      fetch: impl,
      tokens: { get: () => 'tok', refresh: async () => 'x' },
    });
    await reportUser(client, {
      body: { targetId: 'aB3dE5fG7hJ9kL1mN3pQ5r', context: 'profile', reason: 'spam' },
    });
    await getConfig(client);
    await putNotificationPrefs(client, {
      body: {
        pushMatches: true,
        pushMessages: true,
        pushLikesDigest: true,
        quietHours: null,
        timezone: 'Asia/Kolkata',
      },
    });
    expect(calls[0]?.headers).toMatchObject({
      'x-app-version': '1.2.3',
      authorization: 'Bearer tok',
      'content-type': 'application/json',
    });
    expect(calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]?.headers['idempotency-key']).toBeUndefined();
    expect(calls[2]?.headers['idempotency-key']).toBeUndefined();
    const filled = await client
      .call(ENDPOINTS.adminGetReport, { params: { id: 'a/b' } })
      .catch((e) => e);
    expect(filled).toBeInstanceOf(ApiError);
    expect(calls[3]?.path).toBe('/v1/admin/reports/a%2Fb');
    await client
      .call(ENDPOINTS.adminListReports, { query: { status: 'open', limit: 5, cursor: undefined } })
      .catch(() => {});
    expect(calls[4]?.path).toBe('/v1/admin/reports?status=open&limit=5');
  });

  it('maps the error envelope (and network failures) to ApiError', async () => {
    const { impl } = fakeFetch({
      'POST /v1/reports': () => [
        409,
        {
          error: {
            code: 'CONFLICT',
            message: 'Already done.',
            requestId: 'req-9',
            details: { a: 1 },
          },
        },
      ],
    });
    const client = createApiClient({
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
      tokens: { get: () => 't', refresh: async () => 't' },
    });
    const error = await reportUser(client, {
      body: { targetId: 'aB3dE5fG7hJ9kL1mN3pQ5r', context: 'profile', reason: 'spam' },
    }).catch((e) => e);
    expect(error).toMatchObject({
      name: 'ApiError',
      code: 'CONFLICT',
      message: 'Already done.',
      status: 409,
      requestId: 'req-9',
      details: { a: 1 },
    });
    const offline = createApiClient({
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: /** @type {any} */ (
        async () => {
          throw new TypeError('fetch failed');
        }
      ),
      tokens: { get: () => null, refresh: async () => '' },
    });
    await expect(getConfig(offline)).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('single flight: concurrent 401s trigger exactly one refresh, then every call retries with the new token', async () => {
    let current = 'old';
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = 'new';
      return 'new';
    });
    const { impl, calls } = fakeFetch({
      'GET /v1/config': ({ headers }) =>
        headers.authorization === 'Bearer new'
          ? [200, { ok: true }]
          : [401, { error: { code: 'UNAUTHENTICATED', message: 'expired', requestId: 'r' } }],
    });
    const client = createApiClient({
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
      tokens: { get: () => current, refresh },
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => getConfig(client)));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(5).fill({ ok: true }));
    expect(calls.filter((c) => c.headers.authorization === 'Bearer new')).toHaveLength(5);
  });

  it('a failed refresh ends the session once and surfaces the error', async () => {
    const onSessionEnded = vi.fn();
    const { impl } = fakeFetch({
      'GET /v1/config': () => [
        401,
        { error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' } },
      ],
    });
    const client = createApiClient({
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
      tokens: {
        get: () => 'old',
        refresh: async () => {
          throw new ApiError({ code: 'REFRESH_TOKEN_REUSED', message: 'reused', status: 401 });
        },
      },
      onSessionEnded,
    });
    await expect(getConfig(client)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it('other 401 codes (for example a pending review) are not retried', async () => {
    const refresh = vi.fn(async () => 'x');
    const { impl } = fakeFetch({
      'GET /v1/config': () => [
        401,
        { error: { code: 'MFA_REQUIRED', message: 'x', requestId: 'r' } },
      ],
    });
    const client = createApiClient({
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
      tokens: { get: () => 't', refresh },
    });
    await expect(getConfig(client)).rejects.toMatchObject({ code: 'MFA_REQUIRED' });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('session tokens', () => {
  it('body transport keeps the refresh token in storage and rotates it', async () => {
    /** @type {string | null} */
    let stored = null;
    const storage = {
      get: async () => stored,
      set: async (/** @type {string} */ t) => void (stored = t),
      clear: async () => void (stored = null),
    };
    const { impl, calls } = fakeFetch({
      'POST /v1/auth/refresh': ({ body }) => [
        200,
        {
          tokens: {
            accessToken: `acc-${body.refreshToken}`,
            accessTokenExpiresAt: '2026-11-22T11:00:00Z',
            refreshToken: `${body.refreshToken}+1`,
            refreshTokenExpiresAt: '2026-12-22T00:00:00Z',
          },
        },
      ],
    });
    const session = createSession({
      transport: 'body',
      storage,
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
    });
    /** @type {any[]} */
    /** @type {any[]} */
    const states = [];
    session.subscribe((s) => states.push(s));
    await session.accept({
      accessToken: 'a0',
      accessTokenExpiresAt: '2026-11-22T10:15:00Z',
      refreshToken: 'r0',
    });
    expect(session.accessToken()).toBe('a0');
    expect(await session.refresh()).toBe('acc-r0');
    expect(stored).toBe('r0+1');
    expect(calls[0]?.body).toEqual({ tokenTransport: 'body', refreshToken: 'r0' });
    expect(calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    await session.end();
    expect(session.accessToken()).toBeNull();
    expect(stored).toBeNull();
    expect(states).toEqual([true, true, false]);
  });

  it('cookie transport sends credentials and no token in the body; a reused token ends the session', async () => {
    /** @type {any[]} */
    const inits = [];
    const impl = /** @type {any} */ (
      async (/** @type {string} */ _u, /** @type {any} */ init) => {
        inits.push(init);
        return new Response(
          JSON.stringify({ error: { code: 'REFRESH_TOKEN_REUSED', message: 'x', requestId: 'r' } }),
          { status: 401 },
        );
      }
    );
    const session = createSession({
      transport: 'cookie',
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
    });
    await session.accept({ accessToken: 'a', accessTokenExpiresAt: '2026-11-22T10:15:00Z' });
    await expect(session.refresh()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(inits[0].credentials).toBe('include');
    expect(JSON.parse(inits[0].body)).toEqual({ tokenTransport: 'cookie' });
    expect(session.accessToken()).toBeNull();
  });

  it('the session client refreshes through the session', async () => {
    let n = 0;
    const { impl } = fakeFetch({
      'POST /v1/auth/refresh': () => [
        200,
        {
          tokens: {
            accessToken: 'fresh',
            accessTokenExpiresAt: '2026-11-22T11:00:00Z',
            refreshTokenExpiresAt: '2026-12-22T00:00:00Z',
          },
        },
      ],
      'GET /v1/config': ({ headers }) =>
        headers.authorization === 'Bearer fresh'
          ? [200, { n: ++n }]
          : [401, { error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' } }],
    });
    const session = createSession({
      transport: 'cookie',
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
    });
    await session.accept({ accessToken: 'stale', accessTokenExpiresAt: '2026-11-22T10:00:00Z' });
    const client = createSessionClient({
      session,
      baseUrl: BASE,
      appVersion: '1.0.0',
      fetch: impl,
    });
    expect(await getConfig(client)).toEqual({ n: 1 });
    expect(session.accessToken()).toBe('fresh');
  });

  it('query keys are stable and scoped', () => {
    expect(keys.messages('c1')).toEqual(['vouch', 'messages', 'c1']);
    expect(keys.matches()).toEqual(['vouch', 'matches']);
  });
});
