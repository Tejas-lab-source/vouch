// @ts-check
import { readdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduleFiles, scaffoldModule } from '../../../../scripts/new-module.js';

const MODULES = fileURLToPath(new URL('../../src/modules/', import.meta.url));

describe('scripts/new-module.js', () => {
  it('produces the standard module layout', () => {
    expect(Object.keys(moduleFiles('stories')).sort()).toEqual([
      'README.md',
      'adapters/http/.gitkeep',
      'adapters/pg/.gitkeep',
      'api.js',
      'application/.gitkeep',
      'domain/.gitkeep',
      'manifest.js',
      'migrations/.gitkeep',
      'ports.js',
      'test/stories.test.js',
    ]);
    expect(() => moduleFiles('Bad-Name')).toThrow(/module name/);
  });

  it('scaffolds a module whose manifest the registry accepts, and refuses to overwrite it', async () => {
    const name = `zzgen${Date.now()}`;
    try {
      const created = await scaffoldModule(name, MODULES);
      expect(created.length).toBe(10);
      const manifestUrl = pathToFileURL(`${MODULES}${name}/manifest.js`).href;
      const { default: manifest } = await import(/* @vite-ignore */ manifestUrl);
      expect(manifest).toMatchObject({ name, version: 1, dependsOn: [] });
      await expect(scaffoldModule(name, MODULES)).rejects.toThrow(/already exists/);
    } finally {
      await rm(`${MODULES}${name}`, { recursive: true, force: true });
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the fixed modules folder
    expect((await readdir(MODULES)).filter((entry) => entry.startsWith('zzgen'))).toEqual([]);
  });
});
