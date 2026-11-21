// @ts-check
import preset from '@vouch/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  preset,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/platform/**/*.js'],
        reporter: ['text-summary', 'text'],
        thresholds: { lines: 90 },
      },
    },
  }),
);
