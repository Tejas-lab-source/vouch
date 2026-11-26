// @ts-check
/**
 * Expo app config (Phase 15; replaces app.json). One config, three build profiles chosen by
 * APP_VARIANT, which eas.json sets per profile:
 * - development: a local API, the dev client.
 * - preview: staging (internal testing track and TestFlight), `staging` channel.
 * - production: production, `production` channel.
 *
 * The API URL and the Sentry DSN come from EAS environment variables (`VOUCH_API_URL`,
 * `SENTRY_DSN`, public values) so they are never hard-coded for an environment. Secrets for
 * source-map upload (`SENTRY_AUTH_TOKEN`) are EAS secrets and never reach the app bundle.
 */

/** @typedef {'development' | 'preview' | 'production'} Variant */

/** @type {Variant} */
const variant = /** @type {Variant} */ (
  ['preview', 'production'].includes(String(process.env.APP_VARIANT))
    ? process.env.APP_VARIANT
    : 'development'
);

const NAMES = new Map([
  ['development', { suffix: '.dev', name: 'Vouch (dev)' }],
  ['preview', { suffix: '.staging', name: 'Vouch (staging)' }],
  ['production', { suffix: '', name: 'Vouch' }],
]);
const naming = NAMES.get(variant) ?? { suffix: '.dev', name: 'Vouch (dev)' };

/** The API for this build; development defaults to the local API. */
const apiUrl =
  process.env.VOUCH_API_URL ?? (variant === 'development' ? 'http://localhost:3000' : undefined);
if (!apiUrl) throw new Error(`VOUCH_API_URL is required for the ${variant} build`);
if (variant !== 'development' && !apiUrl.startsWith('https://')) {
  throw new Error('VOUCH_API_URL must be https for store builds');
}

const bundleId = `app.vouch.mobile${naming.suffix}`;

export default {
  expo: {
    name: naming.name,
    slug: 'vouch',
    scheme: variant === 'production' ? 'vouch' : `vouch${naming.suffix.replace('.', '-')}`,
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: bundleId,
      supportsTablet: false,
      config: { usesNonExemptEncryption: false },
    },
    android: { package: bundleId },
    plugins: [
      ['expo-router', { root: './src/routes' }],
      'expo-secure-store',
      'expo-notifications',
      [
        'expo-image-picker',
        {
          photosPermission: 'Vouch uses the photos you choose for your profile.',
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        'expo-splash-screen',
        {
          backgroundColor: '#ffffff',
          dark: { backgroundColor: '#121216' },
          imageWidth: 120,
        },
      ],
      // Uploads source maps during EAS builds when SENTRY_AUTH_TOKEN is set (an EAS secret).
      [
        '@sentry/react-native/expo',
        {
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT_MOBILE ?? 'vouch-mobile',
        },
      ],
    ],
    experiments: { typedRoutes: false },
    extra: {
      apiUrl,
      variant,
      ...(process.env.SENTRY_DSN ? { sentryDsn: process.env.SENTRY_DSN } : {}),
      ...(process.env.GRIEVANCE_EMAIL ? { grievanceEmail: process.env.GRIEVANCE_EMAIL } : {}),
      ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
    },
    ...(process.env.EAS_OWNER ? { owner: process.env.EAS_OWNER } : {}),
  },
};
