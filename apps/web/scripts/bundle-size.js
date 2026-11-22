// @ts-check
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Roadmap Phase 11: the initial JavaScript must stay under 200 KB gzipped. */
export const BUDGET_BYTES = 200 * 1024;

/**
 * Gzipped size of the JavaScript loaded before first render: the entry chunk and its static
 * imports (lazy routes are excluded), from Vite's build manifest.
 * @param {string} dist
 */
export async function initialJsSize(dist) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the build output folder
  const manifest = JSON.parse(await readFile(join(dist, '.vite', 'manifest.json'), 'utf8'));
  const chunks = new Map(Object.entries(manifest));
  const entry = [...chunks.values()].find((/** @type {any} */ c) => c.isEntry);
  if (!entry) throw new Error('no entry chunk in the manifest');
  const seen = new Set();
  /** @param {any} chunk */
  const visit = (chunk) => {
    if (!chunk || seen.has(chunk.file)) return;
    seen.add(chunk.file);
    for (const name of chunk.imports ?? []) visit(chunks.get(name));
  };
  visit(entry);
  let total = 0;
  for (const file of seen) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- files named by the manifest
    total += gzipSync(await readFile(join(dist, file))).length;
  }
  return { files: [...seen], gzipBytes: total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const { files, gzipBytes } = await initialJsSize(dist);
  const kb = (gzipBytes / 1024).toFixed(1);
  process.stdout.write(`initial JS: ${kb} KB gzipped (${files.join(', ')}); budget 200 KB\n`);
  if (gzipBytes > BUDGET_BYTES) {
    process.stderr.write('Initial JS is over the 200 KB budget.\n');
    process.exitCode = 1;
  }
}
