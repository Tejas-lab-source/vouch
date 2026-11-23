// @ts-check
import { monitoringOptions } from '@vouch/features-core';
import { DEPLOY_ENV, RELEASE, SENTRY_DSN } from '../shared/config/index.js';

/** @type {typeof import('@sentry/react') | null} */
let sentry = null;

/**
 * Starts error reporting when the build has a Sentry DSN (Phase 15). The SDK is loaded as its
 * own chunk after the first render, so it never delays the app or counts against the main
 * bundle. Personal data is scrubbed before sending (`@vouch/features-core` monitoring).
 */
export async function startMonitoring() {
  const options = monitoringOptions({ dsn: SENTRY_DSN, release: RELEASE, environment: DEPLOY_ENV });
  if (!options || sentry) return;
  const Sentry = await import('@sentry/react');
  Sentry.init(options);
  sentry = Sentry;
}

/**
 * Reports an error caught by a boundary. A no-op without monitoring.
 * @param {unknown} error
 * @param {{ componentStack?: string | null }} [info]
 */
export function reportError(error, info) {
  sentry?.captureException(error, {
    contexts: { react: { componentStack: info?.componentStack ?? '' } },
  });
}
