// @ts-check

/** Build-time settings (Vite env). The API is served under the same origin (see vite.config.js). */
export const APP_VERSION = '1.0.0';
export const API_BASE = '';
/** Cloudflare Turnstile site key (Phase 15). Without one, the development captcha token is used. */
export const TURNSTILE_SITE_KEY = /** @type {string | undefined} */ (
  /** @type {any} */ (import.meta).env?.VITE_TURNSTILE_SITE_KEY
);
