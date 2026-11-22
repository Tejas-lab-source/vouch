// @ts-check
import preset from '@vouch/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Invariant tests (`pnpm test:invariants`): concurrency properties checked many times, with
 * timing targets. They run on their own, after the main suite, so other suites' containers and
 * CPU load do not skew the timings.
 */
export default mergeConfig(
  preset,
  defineConfig({
    test: { include: ['test/invariants/**/*.test.js'], fileParallelism: false },
  }),
);
