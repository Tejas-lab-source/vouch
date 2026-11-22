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
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/test/boundaries/fixtures/**',
    ],
  },
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
    // JSX (Phase 11). ESLint's scope analysis does not count JSX usage, so unused variables
    // in .jsx files are left to TypeScript (`noUnusedLocals`), which understands JSX.
    files: ['**/*.jsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-unused-vars': 'off' },
  },
  {
    files: ['**/*.cjs'],
    ...n.configs['flat/recommended-script'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
];

/**
 * Extra config for frontend packages and apps (browser, React Native, bundlers): browser
 * globals, and the Node-only rules of eslint-plugin-n off (bundlers resolve imports, and the
 * code runs in browsers and React Native, not Node).
 * @type {import('eslint').Linter.Config[]}
 */
export const frontend = [
  {
    files: ['**/*.js', '**/*.jsx'],
    ignores: ['**/*.config.js', 'scripts/**', 'e2e/**'],
    languageOptions: { globals: { ...globals.browser } },
    rules: Object.fromEntries(
      Object.keys(n.configs['flat/recommended-module'].rules ?? {}).map((rule) => [rule, 'off']),
    ),
  },
];
