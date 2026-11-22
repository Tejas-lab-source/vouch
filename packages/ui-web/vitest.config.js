// @ts-check
import { defineConfig } from 'vitest/config';

/** Component tests run in jsdom, with JSX compiled for React's automatic runtime. */
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}'],
    testTimeout: 10_000,
    restoreMocks: true,
  },
});
