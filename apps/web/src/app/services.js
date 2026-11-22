// @ts-check
import { createSession, createSessionClient, keys } from '@vouch/api-client';
import { createAuthFlow, createEventHub, createLogAnalytics } from '@vouch/features-core';
import { createRealtime, memoryCursors, queryCacheAdapter } from '@vouch/realtime';
import { QueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { API_BASE, APP_VERSION } from '../shared/config/index.js';
import { captchaToken } from '../shared/lib/captcha.js';
import { webPhotoIo } from '../shared/lib/photo-io.js';
import { createLocalPrefs } from '../shared/lib/prefs.js';
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
  const events = createEventHub();
  const realtime = createRealtime({
    url: baseUrl,
    connect: io,
    session,
    cursors: memoryCursors(),
    onMessage: cache.onMessage,
    onEvent: (event, payload) => {
      cache.onEvent(event);
      events.emit(event, payload);
    },
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
  // Analytics only logs in v1 (development builds), never personal data (docs/analytics.md).
  const dev = Boolean(/** @type {any} */ (import.meta).env?.DEV);
  const analytics = createLogAnalytics((line) => {
    // eslint-disable-next-line no-console -- the v1 analytics adapter is a development log
    if (dev) console.debug(line);
  });
  return {
    session,
    client,
    queryClient,
    realtime,
    registry: createWebRegistry(),
    auth,
    events,
    analytics,
    prefs: createLocalPrefs(),
    photoIo: webPhotoIo,
  };
}

/** @typedef {ReturnType<typeof createServices>} WebServices */
