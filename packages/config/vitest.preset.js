// @ts-check
import { defineConfig } from 'vitest/config';

/** Shared Vitest preset. Packages extend it with `mergeConfig`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
    testTimeout: 10_000,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
