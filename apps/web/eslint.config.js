// @ts-check
import shared, { frontend } from '@vouch/config/eslint';

export default [
  { ignores: ['dist/**', 'test-results/**', 'playwright-report/**'] },
  ...shared,
  ...frontend,
];
