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
        // Phase 14 targets: 90% on the platform, 85% on the modules (lines).
        include: ['src/platform/**/*.js', 'src/modules/**/*.js'],
        // The example module is a template for new modules, not product code.
        exclude: ['src/modules/_example/**'],
        reporter: ['text-summary', 'text', 'json-summary'],
        thresholds: {
          'src/platform/**/*.js': { lines: 90 },
          'src/modules/**/*.js': { lines: 85 },
        },
      },
    },
  }),
);
