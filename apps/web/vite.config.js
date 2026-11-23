// @ts-check
import react from '@vitejs/plugin-react';
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

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { manifest: true, sourcemap: true, target: 'es2022' },
});
