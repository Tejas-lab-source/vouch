// @ts-check
/**
 * Boundary rules from docs/ROADMAP.md Part B.4, enforced with `pnpm check:boundaries`.
 *
 * Backend modules live in apps/api/src/modules/<name>/ with hexagonal layers:
 * domain/ -> application/ -> ports.js -> adapters/. Frontend apps follow
 * Feature-Sliced Design: app -> pages -> widgets -> features -> entities -> shared.
 */

const MODULES = '^apps/api/src/modules';
const PLATFORM = '^apps/api/src/platform/';
const FRONTEND = '^apps/(web|mobile|admin)/src';
const NPM = 'node_modules/';

/** FSD layers from highest to lowest. */
const FSD_LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];

/** Layers that are split into slices (same-layer slices must not import each other). */
const SLICED_LAYERS = ['pages', 'widgets', 'features', 'entities'];

/**
 * A layer may import only layers strictly below it.
 * @returns {import('dependency-cruiser').IForbiddenRuleType[]}
 */
function fsdLayerRules() {
  return FSD_LAYERS.slice(1).map((layer, index) => {
    const higher = FSD_LAYERS.slice(0, index + 1).join('|');
    return {
      name: `fsd-${layer}-no-higher-layer`,
      comment: `Frontend layer "${layer}" may only import layers strictly below it (${higher} are higher).`,
      severity: 'error',
      from: { path: `${FRONTEND}/${layer}/` },
      to: { path: `${FRONTEND}/(${higher})/` },
    };
  });
}

/**
 * Slices on the same layer must not import each other.
 * @returns {import('dependency-cruiser').IForbiddenRuleType[]}
 */
function fsdSliceRules() {
  return SLICED_LAYERS.map((layer) => ({
    name: `fsd-${layer}-no-cross-slice`,
    comment: `A "${layer}" slice must not import another "${layer}" slice.`,
    severity: 'error',
    from: { path: `${FRONTEND}/${layer}/([^/]+)/` },
    to: { path: `${FRONTEND}/${layer}/`, pathNot: `${FRONTEND}/${layer}/$2/` },
  }));
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---- Backend module layers -------------------------------------------------
    {
      name: 'domain-pure',
      comment:
        'modules/X/domain may import only its own domain files and packages/domain: ' +
        'no I/O (Node built-ins, npm packages) and no other module.',
      severity: 'error',
      from: { path: `${MODULES}/([^/]+)/domain/` },
      to: { pathNot: [`${MODULES}/$1/domain/`, '^packages/domain/'] },
    },
    {
      name: 'application-allowed-imports',
      comment:
        'modules/X/application may import only its own domain, application and ports, ' +
        'packages/contracts and platform/uow (never adapters, Fastify, postgres.js or ioredis).',
      severity: 'error',
      from: { path: `${MODULES}/([^/]+)/application/` },
      to: {
        pathNot: [
          `${MODULES}/$1/(domain|application)/`,
          `${MODULES}/$1/ports\\.js$`,
          '^packages/contracts/',
          `${PLATFORM}uow(\\.js$|/)`,
        ],
      },
    },
    {
      name: 'api-only-own-application',
      comment: 'modules/X/api.js may import only its own application layer (never adapters).',
      severity: 'error',
      from: { path: `${MODULES}/([^/]+)/api\\.js$` },
      to: { pathNot: `${MODULES}/$1/application/` },
    },
    {
      name: 'no-module-internals',
      comment:
        "A module must not import another module's internals. Cross-module calls go " +
        "through the other module's api.js (domain and application may not cross at all).",
      severity: 'error',
      from: { path: `${MODULES}/([^/]+)/` },
      to: { path: `${MODULES}/`, pathNot: [`${MODULES}/$1/`, `${MODULES}/[^/]+/api\\.js$`] },
    },
    {
      name: 'platform-no-modules',
      comment: 'src/platform is the kernel and must not import any module.',
      severity: 'error',
      from: { path: PLATFORM },
      to: { path: `${MODULES}/` },
    },
    {
      name: 'contracts-zod-only',
      comment:
        'packages/contracts may import only zod and its own files (tests and tool config files excepted).',
      severity: 'error',
      from: {
        path: '^packages/contracts/',
        pathNot: ['^packages/contracts/test/', '^packages/contracts/[^/]+\\.config\\.js$'],
      },
      to: {
        pathNot: [
          '^packages/contracts/',
          `${NPM}zod/`,
          `${NPM}\\.pnpm/zod@[^/]+/node_modules/zod/`,
        ],
      },
    },

    // ---- Frontend (Feature-Sliced Design) ---------------------------------------
    ...fsdLayerRules(),
    ...fsdSliceRules(),

    // ---- Workspace-wide hygiene ---------------------------------------------------
    {
      name: 'no-cross-app-imports',
      comment: 'An app must not import another app; share code through packages/.',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'packages-no-apps',
      comment: 'Shared packages must never import application code.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies make module boundaries and load order unclear.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve to a file or an installed package.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'src-not-to-dev-dependency',
      comment: 'Runtime source must not import devDependencies (they are absent in the image).',
      severity: 'error',
      from: { path: '^apps/[^/]+/src/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: NPM },
    exclude: {
      path: [
        '/coverage/',
        '/\\.turbo/',
        '/test/boundaries/fixtures/',
        '/dist/',
        '/\\.expo/',
        '/test-results/',
        '/playwright-report/',
      ],
    },
    moduleSystems: ['es6', 'cjs'],
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
