// @ts-check

/**
 * Error-reporting options shared by web, admin and mobile (Phase 15). Sentry is configured
 * here as plain data, so this package does not depend on any Sentry SDK.
 *
 * Privacy (DPDP; the same rule as the API's logs): no email addresses, tokens, cookies, request
 * bodies, query strings or console output leave the device. Only the error, its stack, the
 * route path and the release.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

/** @param {unknown} value @returns {any} */
function scrubText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(EMAIL, '[email]')
    .replace(BEARER, '$1[token]')
    .replace(JWT, '[token]')
    .replace(LONG_TOKEN, '[token]');
}

/** A URL without its query string or fragment. @param {unknown} url @returns {any} */
function stripQuery(url) {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return scrubText(cut === -1 ? url : url.slice(0, cut));
}

/**
 * Removes personal data from a Sentry event before it is sent (`beforeSend`).
 * @template {Record<string, any>} E
 * @param {E} event
 * @returns {E}
 */
export function scrubEvent(event) {
  const next = /** @type {any} */ ({ ...event });
  delete next.user;
  delete next.server_name;
  if (next.request) {
    next.request = { url: stripQuery(next.request.url), method: next.request.method };
  }
  if (typeof next.message === 'string') next.message = scrubText(next.message);
  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((/** @type {any} */ v) => ({
        ...v,
        value: scrubText(v.value),
      })),
    };
  }
  if (Array.isArray(next.breadcrumbs)) {
    next.breadcrumbs = next.breadcrumbs
      .map((/** @type {any} */ b) => scrubBreadcrumb(b))
      .filter(Boolean);
  }
  delete next.extra;
  return next;
}

/**
 * Keeps navigation and network breadcrumbs without query strings; drops console and UI text.
 * @param {Record<string, any>} breadcrumb
 * @returns {Record<string, any> | null}
 */
export function scrubBreadcrumb(breadcrumb) {
  const category = String(breadcrumb.category ?? '');
  if (category === 'console' || category.startsWith('ui.')) return null;
  const data = breadcrumb.data
    ? {
        ...(breadcrumb.data.method ? { method: breadcrumb.data.method } : {}),
        ...(breadcrumb.data.status_code ? { status_code: breadcrumb.data.status_code } : {}),
        ...(breadcrumb.data.url ? { url: stripQuery(breadcrumb.data.url) } : {}),
        ...(breadcrumb.data.from ? { from: stripQuery(breadcrumb.data.from) } : {}),
        ...(breadcrumb.data.to ? { to: stripQuery(breadcrumb.data.to) } : {}),
      }
    : undefined;
  return {
    ...breadcrumb,
    message: scrubText(breadcrumb.message),
    ...(data ? { data } : {}),
  };
}

/**
 * Sentry options for one app. Returns null without a DSN (development and tests), so callers
 * never load the SDK then.
 * @param {{ dsn?: string | null, release?: string | null, environment?: string | null }} settings
 */
export function monitoringOptions({ dsn, release, environment }) {
  if (!dsn) return null;
  return {
    dsn,
    release: release ?? undefined,
    environment: environment ?? 'production',
    sendDefaultPii: false,
    // Errors only: performance tracing comes from the API's OpenTelemetry (Phase 15).
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
