// @ts-check
import js from '@eslint/js';
import n from 'eslint-plugin-n';
import security from 'eslint-plugin-security';
import globals from 'globals';
import { requireTsCheck } from './eslint-rules/require-ts-check.js';

/** Local rules shared by every package. */
const vouchPlugin = { rules: { 'require-ts-check': requireTsCheck } };

/**
 * Shared ESLint 9 flat config for all Vouch packages (Node, ESM).
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**', '**/.turbo/**'] },
  js.configs.recommended,
  n.configs['flat/recommended-module'],
  security.configs.recommended,
  {
    plugins: { vouch: vouchPlugin },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'vouch/require-ts-check': 'error',
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.cjs'],
    ...n.configs['flat/recommended-script'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
];
