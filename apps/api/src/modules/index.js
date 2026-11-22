// @ts-check
import identity from './identity/manifest.js';
import media from './media/manifest.js';
import profiles from './profiles/manifest.js';

/**
 * The explicit, ordered list of production modules (ARCHITECTURE.md 6.2). A new module is
 * one line here. `_example` is test-only and never listed.
 * @type {import('../platform/registry.js').Manifest[]}
 */
export default [identity, profiles, media];
