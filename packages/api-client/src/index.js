// @ts-check
import { ApiError, createApiClient, SESSION_OVER } from './client.js';
import { ENDPOINTS, refreshTokens } from './generated.js';

export * from './generated.js';
export { ApiError, createApiClient, SESSION_OVER };

/**
 * TanStack Query key factories. Every server-state cache entry uses one of these, so
 * invalidation (for example from realtime events) targets exactly what changed.
 */
export const keys = Object.freeze({
  all: /** @type {const} */ (['vouch']),
  config: () => /** @type {const} */ (['vouch', 'config']),
  me: () => /** @type {const} */ (['vouch', 'me']),
  deck: () => /** @type {const} */ (['vouch', 'deck']),
  matches: () => /** @type {const} */ (['vouch', 'matches']),
  likesCount: () => /** @type {const} */ (['vouch', 'likes-count']),
  conversations: () => /** @type {const} */ (['vouch', 'conversations']),
  /** @param {string} conversationId */
  messages: (conversationId) => /** @type {const} */ (['vouch', 'messages', conversationId]),
});

/**
 * @typedef {object} TokenStorage  Where a refresh token survives restarts (mobile: the
 *   platform's secure store). Web keeps it in an httpOnly cookie instead and passes none.
 * @property {() => Promise<string | null>} get
 * @property {(token: string) => Promise<void>} set
 * @property {() => Promise<void>} clear
 */

/**
 * The session's tokens. The access token lives in memory only. The refresh token travels as
 * an httpOnly cookie on the web (`transport: 'cookie'`) or is kept in secure storage on mobile
 * (`transport: 'body'`). `refresh()` rotates both.
 * @param {{ transport: 'cookie' | 'body', storage?: TokenStorage, baseUrl: string, appVersion: string, fetch?: typeof fetch, newKey?: () => string }} options
 */
export function createSession({
  transport,
  storage,
  baseUrl,
  appVersion,
  fetch: fetchImpl,
  newKey,
}) {
  if (transport === 'body' && !storage) throw new Error('body transport needs a token storage');
  /** @type {{ token: string, expiresAt: number } | null} */
  let access = null;
  /** @type {Set<(signedIn: boolean) => void>} */
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener(access !== null));

  // The refresh call itself is public and never retried through the 401 path.
  const raw = createApiClient({
    baseUrl,
    appVersion,
    fetch: fetchImpl,
    credentials: transport === 'cookie' ? 'include' : 'omit',
    ...(newKey ? { newKey } : {}),
    tokens: { get: () => null, refresh: () => Promise.reject(new Error('not used')) },
  });

  /** @param {{ accessToken: string, accessTokenExpiresAt: string, refreshToken?: string }} pair */
  async function accept(pair) {
    access = { token: pair.accessToken, expiresAt: Date.parse(pair.accessTokenExpiresAt) };
    if (transport === 'body' && pair.refreshToken) await storage?.set(pair.refreshToken);
    notify();
  }

  async function refresh() {
    const stored = transport === 'body' ? await storage?.get() : null;
    if (transport === 'body' && !stored) {
      throw new ApiError({ code: 'REFRESH_TOKEN_INVALID', message: 'Sign in again.', status: 401 });
    }
    try {
      const { tokens } = await refreshTokens(raw, {
        body:
          transport === 'cookie'
            ? { tokenTransport: 'cookie' }
            : { tokenTransport: 'body', refreshToken: /** @type {string} */ (stored) },
      });
      await accept(tokens);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof ApiError && SESSION_OVER.has(error.code)) await end();
      throw error;
    }
  }

  async function end() {
    access = null;
    if (transport === 'body') await storage?.clear();
    notify();
  }

  return {
    transport,
    accept,
    refresh,
    end,
    /** The current access token, or null when signed out. */
    accessToken: () => access?.token ?? null,
    /** Epoch ms when the access token expires (for the socket's `auth.refresh`). */
    expiresAt: () => access?.expiresAt ?? null,
    /** @param {(signedIn: boolean) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** @typedef {ReturnType<typeof createSession>} Session */

/**
 * The client bound to a session: signed-in calls carry its access token and refresh it once
 * on a 401; a failed refresh ends the session.
 * `newKey` makes idempotency keys (React Native has no `crypto.randomUUID`; pass expo-crypto's).
 * @param {{ session: Session, baseUrl: string, appVersion: string, fetch?: typeof fetch, newKey?: () => string }} options
 */
export function createSessionClient({ session, baseUrl, appVersion, fetch: fetchImpl, newKey }) {
  return createApiClient({
    baseUrl,
    appVersion,
    fetch: fetchImpl,
    ...(newKey ? { newKey } : {}),
    credentials: session.transport === 'cookie' ? 'include' : 'omit',
    tokens: { get: () => session.accessToken(), refresh: () => session.refresh() },
    onSessionEnded: () => void session.end(),
  });
}

export { ENDPOINTS };
