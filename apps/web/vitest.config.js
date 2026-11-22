// @ts-check
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Component tests (jsdom); end-to-end tests are in e2e/ (Playwright). */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    setupFiles: ['./test/setup.js'],
  },
});
