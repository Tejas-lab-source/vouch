// @ts-check
import preset from '@vouch/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  preset,
  defineConfig({
    test: {
      // Invariant tests measure timings and run alone (vitest.invariants.config.js).
      exclude: ['**/node_modules/**', 'test/invariants/**'],
      coverage: {
        provider: 'v8',
        include: ['src/platform/**/*.js'],
        reporter: ['text-summary', 'text'],
        thresholds: { lines: 90 },
      },
    },
  }),
);
