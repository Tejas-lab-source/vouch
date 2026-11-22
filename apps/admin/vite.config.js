// @ts-check
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The admin API is proxied under the same origin (no CORS, no third-party origin). */
const api = process.env.VOUCH_API ?? 'http://localhost:3000';
const proxy = { '/v1': { target: api, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy },
  preview: { port: 4174, proxy },
  build: { target: 'es2022' },
});
