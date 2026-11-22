// @ts-check
import { ApiError, adminLogin, createApiClient } from '@vouch/api-client';
import { APP_VERSION } from '../../shared/config/index.js';

/**
 * The staff session (ADR 0018): the admin token lives in memory only (never in storage), lasts
 * at most an hour and has no refresh. Any 401 signs the staff member out.
 * @param {{ baseUrl: string, fetch?: typeof fetch }} options
 */
export function createStaffSession({ baseUrl, fetch }) {
  /** @type {{ token: string, displayName: string, role: 'moderator' | 'admin' } | null} */
  let current = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const end = () => {
    current = null;
    notify();
  };
  const client = createApiClient({
    baseUrl,
    appVersion: APP_VERSION,
    fetch,
    tokens: {
      get: () => current?.token ?? null,
      refresh: () =>
        Promise.reject(
          new ApiError({ code: 'UNAUTHENTICATED', message: 'Sign in again.', status: 401 }),
        ),
    },
    onSessionEnded: end,
  });
  return {
    client,
    /** @param {{ email: string, password: string, totp: string }} body */
    async signIn(body) {
      const result = await adminLogin(client, { body });
      current = { token: result.accessToken, ...result.admin };
      notify();
    },
    signOut: end,
    staff: () => current,
    /** @param {() => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** @typedef {ReturnType<typeof createStaffSession>} StaffSession */
