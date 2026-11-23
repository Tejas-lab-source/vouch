// @ts-check
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig } from 'vite';

/**
 * The API is proxied under the same origin (`/v1`, `/socket.io`), so the refresh cookie
 * (`SameSite=Strict`, path `/v1/auth/refresh`) works and no CORS is needed. `VOUCH_API` points
 * at the API (default: the local `pnpm dev` API on :3000).
 */
const api = process.env.VOUCH_API ?? 'http://localhost:3000';
const proxy = {
  '/v1': { target: api, changeOrigin: false },
  '/socket.io': { target: api, ws: true, changeOrigin: false },
};

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
        project: process.env.SENTRY_PROJECT_WEB ?? 'vouch-web',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: process.env.VITE_RELEASE },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
    ]
  : [];

export default defineConfig({
  plugins: [react(), ...sentry],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { manifest: true, sourcemap: uploadMaps ? 'hidden' : true, target: 'es2022' },
});
