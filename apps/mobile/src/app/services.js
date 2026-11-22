// @ts-check
import { createSession, createSessionClient, keys } from '@vouch/api-client';
import { createAuthFlow } from '@vouch/features-core';
import { createRealtime, memoryCursors, queryCacheAdapter } from '@vouch/realtime';
import { QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import { io } from 'socket.io-client';
import { API_URL, APP_VERSION } from '../shared/config/index.js';
import { captchaToken } from '../shared/lib/captcha.js';
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
  const realtime = createRealtime({
    url: API_URL,
    connect: io,
    session,
    cursors: memoryCursors(),
    onMessage: cache.onMessage,
    onEvent: cache.onEvent,
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
  return { session, client, queryClient, realtime, registry: createMobileRegistry(), auth };
}
