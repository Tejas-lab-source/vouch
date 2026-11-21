// @ts-check
import shared from '@vouch/config/eslint';

/** Lints root-level files only; each workspace package runs its own lint. */
export default [{ ignores: ['apps/**', 'packages/**'] }, ...shared];
