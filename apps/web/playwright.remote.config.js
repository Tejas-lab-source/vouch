// @ts-check
import { defineConfig } from '@playwright/test';

/**
 * Read-only browser checks against a deployed environment (Phase 15): staging before
 * promotion. No account is created and no email is sent (OTP emails cannot be read there).
 *   REMOTE_WEB_URL=https://… REMOTE_ADMIN_URL=https://… REMOTE_API_URL=https://… \
 *     pnpm --filter @vouch/web e2e:remote
 */
export default defineConfig({
  testDir: 'e2e-remote',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off', viewport: { width: 1280, height: 800 } },
});
