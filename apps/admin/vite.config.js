// @ts-check
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig } from 'vite';

/** The admin API is proxied under the same origin (no CORS, no third-party origin). */
const api = process.env.VOUCH_API ?? 'http://localhost:3000';
const proxy = { '/v1': { target: api, changeOrigin: false } };

/**
 * Source maps go to Sentry, not to the public site (Phase 15): with SENTRY_AUTH_TOKEN (the
 * deploy job), maps are built hidden, uploaded for the release (VITE_RELEASE) and deleted
 * before the Pages upload. Without it (local builds) nothing is uploaded.
 */
const uploadMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);
const sentry = uploadMaps
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT_ADMIN ?? 'vouch-admin',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: process.env.VITE_RELEASE },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
    ]
  : [];

export default defineConfig({
  plugins: [react(), ...sentry],
  server: { port: 5174, proxy },
  preview: { port: 4174, proxy },
  build: { target: 'es2022', sourcemap: uploadMaps ? 'hidden' : false },
});
