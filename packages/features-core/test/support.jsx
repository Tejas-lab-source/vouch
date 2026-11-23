// @ts-check
import { createApiClient } from '@vouch/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppServicesProvider, createFeatureRegistry } from '../src/index.js';

/**
 * A scripted API: each route is a function of (body, callIndex) returning [status, body].
 * Calls are recorded.
 * @param {Record<string, (body: any, n: number, url: URL) => [number, unknown] | Promise<[number, unknown]>>} routes
 */
export function fakeApi(routes) {
  /** @type {{ route: string, body: any, headers: Record<string, string> }[]} */
  const calls = [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  const fetch = /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {any} */ init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ route: key, body, headers: init.headers });
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      const handler = new Map(Object.entries(routes)).get(key);
      const [status, payload] = handler
        ? await handler(body, n, u)
        : [404, { error: { code: 'NOT_FOUND', message: 'x' } }];
      return new Response(status === 204 ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
  );
  const client = createApiClient({
    baseUrl: 'http://api',
    appVersion: '1.0.0',
    fetch,
    tokens: { get: () => 'token', refresh: async () => 'token' },
  });
  return {
    client,
    calls,
    count: (/** @type {string} */ route) => calls.filter((c) => c.route === route).length,
  };
}

/** @param {ReturnType<typeof fakeApi>} api @param {Partial<import('../src/react.jsx').AppServices>} [extra] */
export function wrapper(api, extra = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tracked = /** @type {string[]} */ ([]);
  let ids = 0;
  const services = /** @type {any} */ ({
    client: api.client,
    session: {},
    registry: createFeatureRegistry([]),
    auth: {},
    analytics: {
      track: (/** @type {string} */ e, /** @type {any} */ p) =>
        tracked.push(`${e} ${JSON.stringify(p ?? {})}`),
    },
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    ...extra,
  });
  const Wrapper = (/** @type {{ children: any }} */ { children }) => (
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={services}>{children}</AppServicesProvider>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient, tracked };
}
