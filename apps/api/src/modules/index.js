// @ts-check
import chat from './chat/manifest.js';
import discovery from './discovery/manifest.js';
import identity from './identity/manifest.js';
import matching from './matching/manifest.js';
import media from './media/manifest.js';
import profiles from './profiles/manifest.js';
import safety from './safety/manifest.js';

/**
 * The explicit, ordered list of production modules (ARCHITECTURE.md 6.2). A new module is
 * one line here. `_example` is test-only and never listed.
 * @type {import('../platform/registry.js').Manifest[]}
 */
export default [identity, profiles, media, safety, discovery, matching, chat];
