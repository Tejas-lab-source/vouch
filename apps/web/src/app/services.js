// @ts-check
import { createSession, createSessionClient, keys } from '@vouch/api-client';
import { createAuthFlow } from '@vouch/features-core';
import { createRealtime, memoryCursors, queryCacheAdapter } from '@vouch/realtime';
import { QueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { API_BASE, APP_VERSION } from '../shared/config/index.js';
import { captchaToken } from '../shared/lib/captcha.js';
import { createWebRegistry } from './features.js';

/**
 * Builds the app's services once: the session (refresh token in an httpOnly cookie, access
 * token in memory), the API client, the query cache, the feature registry, the auth flow, and
 * the realtime client (started on sign-in).
 * @param {{ fetch?: typeof fetch, baseUrl?: string }} [options]
 */
export function createServices({ fetch, baseUrl = API_BASE || globalThis.location.origin } = {}) {
  const session = createSession({ transport: 'cookie', baseUrl, appVersion: APP_VERSION, fetch });
  const client = createSessionClient({ session, baseUrl, appVersion: APP_VERSION, fetch });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
  const cache = queryCacheAdapter(queryClient, keys);
  const realtime = createRealtime({
    url: baseUrl,
    connect: io,
    session,
    cursors: memoryCursors(),
    onMessage: cache.onMessage,
    onEvent: cache.onEvent,
  });
  session.subscribe((signedIn) => {
    if (signedIn) realtime.start();
    else {
      realtime.stop();
      queryClient.clear();
    }
  });
  const auth = createAuthFlow({
    client,
    session,
    platform: 'web',
    appVersion: APP_VERSION,
    captchaToken,
  });
  return { session, client, queryClient, realtime, registry: createWebRegistry(), auth };
}

/** @typedef {ReturnType<typeof createServices>} WebServices */
