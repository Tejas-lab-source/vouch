// @ts-check
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MODULES_DIR = fileURLToPath(new URL('../apps/api/src/modules/', import.meta.url));
const NAME = /^[a-z][a-z0-9]*$/;

/**
 * Files for a new module, following ARCHITECTURE.md 5.2. Pure: returns path → content.
 * @param {string} name
 * @returns {Record<string, string>}
 */
export function moduleFiles(name) {
  if (!NAME.test(name)) throw new Error(`module name must match ${NAME}: ${name}`);
  const title = name[0]?.toUpperCase() + name.slice(1);
  return {
    'manifest.js': `// @ts-check
import { defineModule } from '../../platform/registry.js';
import { create${title}Api } from './api.js';

export default defineModule({
  name: '${name}',
  version: 1,
  dependsOn: [],
  api: (/** @type {any} */ ctx) => create${title}Api({ uow: ctx.unitOfWork('${name}'), useCase: ctx.useCase }),
  migrations: new URL('./migrations', import.meta.url),
});
`,
    'api.js': `// @ts-check

/**
 * Public in-process API of the ${name} module. Other modules call only this.
 * @param {import('./ports.js').${title}Deps} _deps
 */
export function create${title}Api(_deps) {
  return {};
}
`,
    'ports.js': `// @ts-check

/**
 * What the ${name} module needs from outside, injected by the registry.
 * @typedef {object} ${title}Deps
 * @property {import('../../platform/uow.js').UnitOfWork<{}>} uow
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 */

export {};
`,
    'README.md': `# ${name}

- **Purpose:** TODO
- **Public API (\`api.js\`):** none yet
- **Events emitted:** none yet
- **Events consumed:** none yet
- **Tables owned:** schema \`${name}\` (see \`migrations/\`)
`,
    'domain/.gitkeep': '',
    'application/.gitkeep': '',
    'adapters/http/.gitkeep': '',
    'adapters/pg/.gitkeep': '',
    'migrations/.gitkeep': '',
    [`test/${name}.test.js`]: `// @ts-check
import { describe, expect, it } from 'vitest';
import manifest from '../manifest.js';

describe('${name} module', () => {
  it('has a valid manifest', () => {
    expect(manifest.name).toBe('${name}');
  });
});
`,
  };
}

/**
 * Scaffolds `apps/api/src/modules/<name>/`. Refuses to overwrite an existing module.
 * @param {string} name
 * @param {string} [root]
 * @returns {Promise<string[]>} Created paths.
 */
export async function scaffoldModule(name, root = MODULES_DIR) {
  const dir = join(root, name);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated module name
  const exists = await stat(dir).then(
    () => true,
    () => false,
  );
  if (exists) throw new Error(`module already exists: ${dir}`);
  const created = [];
  for (const [relative, content] of Object.entries(moduleFiles(name))) {
    const path = join(dir, relative);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the new module folder
    await mkdir(dirname(path), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the new module folder
    await writeFile(path, content);
    created.push(path);
  }
  return created;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2] ?? '';
  try {
    const created = await scaffoldModule(name);
    process.stdout.write(`Created ${created.length} files in apps/api/src/modules/${name}/\n`);
    process.stdout.write(
      `Next: add it to apps/api/src/modules/index.js and its migrations to migrations/run.js.\n`,
    );
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
