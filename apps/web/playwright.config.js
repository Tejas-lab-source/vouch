// @ts-check
import { defineConfig } from '@playwright/test';

/** Web end-to-end tests against the real API (see e2e/stack.js). */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  globalSetup: './e2e/global-setup.js',
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off', viewport: { width: 1280, height: 800 } },
});
