// @ts-check

/** @type {Record<string, string | undefined>} */
const env = /** @type {any} */ (import.meta).env ?? {};

/** Build-time settings (Vite env). */
export const APP_VERSION = '1.0.0';
/**
 * The API's own origin (Phase 15), for example `https://api.example.app`: the web app and the
 * API are on the same site, so the refresh cookie (host-only on the API, `SameSite=Strict`)
 * still works, and the API lists this app's origin in CORS_ORIGINS. Empty in development,
 * where Vite proxies `/v1` and `/socket.io` under the same origin (vite.config.js).
 */
export const API_BASE = env.VITE_API_BASE ?? '';
/** Error reporting (Phase 15): off without a DSN. */
export const SENTRY_DSN = env.VITE_SENTRY_DSN ?? null;
/** The release (the git commit) for error reports and source maps; set by the deploy job. */
export const RELEASE = env.VITE_RELEASE ?? null;
/** `staging` or `production`; set by the deploy job. */
export const DEPLOY_ENV = env.VITE_DEPLOY_ENV ?? 'development';
/** Cloudflare Turnstile site key (Phase 15). Without one, the development captcha token is used. */
export const TURNSTILE_SITE_KEY = /** @type {string | undefined} */ (
  /** @type {any} */ (import.meta).env?.VITE_TURNSTILE_SITE_KEY
);
/**
 * The grievance officer's address shown on the privacy page (DPDP). A placeholder until the
 * owner provides the real one (Phase 15, `VITE_GRIEVANCE_EMAIL`).
 */
export const GRIEVANCE_EMAIL =
  /** @type {string | undefined} */ (/** @type {any} */ (import.meta).env?.VITE_GRIEVANCE_EMAIL) ??
  'grievance@vouch.example';
