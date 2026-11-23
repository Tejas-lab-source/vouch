// @ts-check
import { createSession, createSessionClient, keys } from '@vouch/api-client';
import { createAuthFlow, createEventHub, createLogAnalytics } from '@vouch/features-core';
import { createRealtime, memoryCursors, queryCacheAdapter } from '@vouch/realtime';
import { QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import { io } from 'socket.io-client';
import { API_URL, APP_VERSION } from '../shared/config/index.js';
import { captchaToken } from '../shared/lib/captcha.js';
import { nativePhotoIo } from '../shared/lib/photo-io.js';
import { securePrefs } from '../shared/lib/prefs.js';
import { secureTokenStorage } from '../shared/lib/secure-storage.js';
import { createMobileRegistry } from './features.js';

/**
 * The mobile app's services: the refresh token in secure storage (body transport), the access
 * token in memory, the API client, the query cache, the feature registry, the auth flow and
 * the realtime client (started on sign-in). Ids come from expo-crypto (Hermes has no
 * `crypto.randomUUID`).
 */
export function createServices() {
  const common = { baseUrl: API_URL, appVersion: APP_VERSION, newKey: randomUUID };
  const session = createSession({ transport: 'body', storage: secureTokenStorage, ...common });
  const client = createSessionClient({ session, ...common });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
  const cache = queryCacheAdapter(queryClient, keys);
  const events = createEventHub();
  const realtime = createRealtime({
    url: API_URL,
    connect: io,
    session,
    cursors: memoryCursors(),
    onMessage: cache.onMessage,
    onEvent: (event, payload) => {
      cache.onEvent(event, payload);
      events.emit(event, payload);
    },
    newId: randomUUID,
  });
  session.subscribe((signedIn) => {
    if (signedIn) realtime.start();
    else {
      realtime.stop();
      queryClient.clear();
    }
  });
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const auth = createAuthFlow({ client, session, platform, appVersion: APP_VERSION, captchaToken });
  // Analytics only logs in v1 (development builds), never personal data (docs/analytics.md).
  const analytics = createLogAnalytics((line) => {
    // eslint-disable-next-line no-console -- the v1 analytics adapter is a development log
    if (/** @type {any} */ (globalThis).__DEV__) console.debug(line);
  });
  return {
    session,
    client,
    queryClient,
    realtime,
    registry: createMobileRegistry(),
    auth,
    events,
    analytics,
    prefs: securePrefs,
    photoIo: nativePhotoIo,
    newId: randomUUID,
  };
}
