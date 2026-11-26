// @ts-check

/** @type {Record<string, string | undefined>} */
const env = /** @type {any} */ (import.meta).env ?? {};

export const APP_VERSION = '1.0.0';
/**
 * The API's own origin (Phase 15), for example `https://api.example.app`. The admin app is on
 * its own subdomain and sends a bearer token (no cookies), so the API only needs this app's
 * origin in CORS_ORIGINS. Empty in development, where Vite proxies `/v1` (vite.config.js).
 */
export const API_BASE = env.VITE_API_BASE ?? '';
/** Error reporting (Phase 15): off without a DSN. */
export const SENTRY_DSN = env.VITE_SENTRY_DSN ?? null;
/** The release (the git commit); set by the deploy job. */
export const RELEASE = env.VITE_RELEASE ?? null;
/** `staging` or `production`; set by the deploy job. */
export const DEPLOY_ENV = env.VITE_DEPLOY_ENV ?? 'development';
