// @ts-check
import * as Sentry from '@sentry/react-native';
import { monitoringOptions } from '@vouch/features-core';
import { APP_VERSION, SENTRY_DSN, VARIANT } from '../shared/config/index.js';

/**
 * Starts crash and error reporting when the build has a Sentry DSN (Phase 15; `extra.sentryDsn`
 * from app.config.js). Personal data is scrubbed before sending (`@vouch/features-core`
 * monitoring). Native crashes and unhandled JS errors are captured by the SDK's handlers.
 */
export function startMonitoring() {
  const options = monitoringOptions({
    dsn: SENTRY_DSN,
    release: `vouch-mobile@${APP_VERSION}`,
    environment: VARIANT === 'preview' ? 'staging' : VARIANT,
  });
  if (!options) return false;
  Sentry.init({ ...options, enableAutoSessionTracking: true, attachScreenshot: false });
  return true;
}
