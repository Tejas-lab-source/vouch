// @ts-check
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

/** @type {import('dependency-cruiser').IConfiguration} */
const config = require('../../../../.dependency-cruiser.cjs');

const M = 'apps/api/src/modules';
const W = 'apps/web/src';

/**
 * Every violation the fixture tree must produce, as `rule: from -> to`.
 * Files not listed here are allowed imports and must stay clean.
 */
const EXPECTED = [
  `domain-pure: ${M}/alpha/domain/io.js -> fs`,
  `application-allowed-imports: ${M}/alpha/application/imports-adapter.js -> ${M}/alpha/adapters/http/route.js`,
  `api-only-own-application: ${M}/beta/api.js -> ${M}/beta/adapters/pg/store.js`,
  `no-module-internals: ${M}/alpha/adapters/http/reaches-internals.js -> ${M}/beta/application/internal.js`,
  `platform-no-modules: apps/api/src/platform/imports-module.js -> ${M}/beta/api.js`,
  `contracts-zod-only: packages/contracts/imports-npm.js -> postgres`,
  `fsd-pages-no-higher-layer: ${W}/pages/p1/index.js -> ${W}/app/index.js`,
  `fsd-widgets-no-higher-layer: ${W}/widgets/w1/index.js -> ${W}/pages/p2/index.js`,
  `fsd-features-no-higher-layer: ${W}/features/f1/index.js -> ${W}/widgets/w2/index.js`,
  `fsd-entities-no-higher-layer: ${W}/entities/e1/index.js -> ${W}/features/f2/index.js`,
  `fsd-shared-no-higher-layer: ${W}/shared/imports-entity.js -> ${W}/entities/e2/index.js`,
  `fsd-pages-no-cross-slice: ${W}/pages/p1/index.js -> ${W}/pages/p2/index.js`,
  `fsd-widgets-no-cross-slice: ${W}/widgets/w1/index.js -> ${W}/widgets/w2/index.js`,
  `fsd-features-no-cross-slice: ${W}/features/f1/index.js -> ${W}/features/f2/index.js`,
  `fsd-entities-no-cross-slice: ${W}/entities/e1/index.js -> ${W}/entities/e2/index.js`,
  `no-cross-app-imports: ${W}/shared/imports-other-app.js -> apps/api/src/platform/uow.js`,
  `packages-no-apps: packages/domain/imports-app.js -> ${W}/shared/ok.js`,
  // A cycle is reported once, on the edge where cruising first closes it.
  `no-circular: packages/domain/cycle-a.js -> packages/domain/cycle-b.js`,
  `not-to-unresolvable: packages/domain/unresolvable.js -> ./does-not-exist.js`,
  `src-not-to-dev-dependency: apps/api/src/uses-dev-dependency.js -> ioredis`,
];

/**
 * Normalises a resolved module path so assertions do not depend on pnpm's store layout.
 * @param {string} path
 * @returns {string}
 */
function normalise(path) {
  if (!path.includes('node_modules/')) return path;
  return path.split('node_modules/').at(-1)?.split('/')[0] ?? path;
}

describe('dependency-cruiser boundary rules', () => {
  /** @type {string[]} */
  let actual;

  beforeAll(async () => {
    const result = await cruise(
      ['apps', 'packages'],
      {
        ...config.options,
        validate: true,
        ruleSet: { forbidden: config.forbidden },
        baseDir: FIXTURES,
        // The real config excludes this fixture tree from `pnpm check:boundaries`.
        exclude: undefined,
      },
      config.options?.enhancedResolveOptions,
    );
    if (typeof result.output === 'string') throw new Error('expected a JSON cruise result');
    actual = result.output.summary.violations.map(
      (v) => `${v.rule.name}: ${v.from} -> ${normalise(v.to)}`,
    );
  }, 30_000);

  it('reports exactly the expected violations, and nothing for allowed imports', () => {
    expect([...actual].sort()).toEqual([...EXPECTED].sort());
  });

  it('has a failing fixture for every rule in the config', () => {
    const covered = new Set(actual.map((line) => line.split(':')[0]));
    const ruleNames = (config.forbidden ?? []).map((rule) => rule.name ?? '<unnamed>');
    expect(ruleNames.filter((name) => !covered.has(name))).toEqual([]);
  });
});
