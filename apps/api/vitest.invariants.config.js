// @ts-check
import preset from '@vouch/config/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Invariant tests (`pnpm test:invariants`): concurrency properties checked many times, with
 * timing targets. They run on their own, after the main suite, so other suites' containers and
 * CPU load do not skew the timings. The include list replaces the preset's (mergeConfig would
 * concatenate it and run every test).
 */
export default defineConfig({
  ...preset,
  test: {
    ...preset.test,
    include: ['test/invariants/**/*.test.js'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
  },
});
