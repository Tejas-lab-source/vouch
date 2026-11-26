// @ts-check
import { defineConfig } from '@playwright/test';

// The stack also exports and serves the mobile app for the web (phone-sized screenshots).
process.env.E2E_MOBILE_WEB = '1';

/** Design screenshots (docs/design/screenshots/), on the e2e stack. Not part of CI. */
export default defineConfig({
  testDir: 'e2e-design',
  outputDir: 'test-results-design',
  testMatch: '**/*.spec.js',
  timeout: 900_000,
  globalSetup: './e2e/global-setup.js',
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off', viewport: { width: 1440, height: 900 } },
});
