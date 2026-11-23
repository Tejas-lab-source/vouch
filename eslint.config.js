// @ts-check
import shared from '@vouch/config/eslint';

/** Lints root-level files only; each workspace package runs its own lint. */
// load/k6 holds k6 scripts (k6's own JavaScript runtime, not Node); load/out is results.
export default [{ ignores: ['apps/**', 'packages/**', 'load/k6/**', 'load/out/**'] }, ...shared];
