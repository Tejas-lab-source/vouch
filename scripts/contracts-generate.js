// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildOpenApi, buildSchemaSnapshot } from '@vouch/contracts/tooling';

/** Generated files, committed so reviewers and the contract diff can see them. */
export const GENERATED = {
  openapi: fileURLToPath(new URL('../packages/contracts/openapi.json', import.meta.url)),
  schemas: fileURLToPath(new URL('../packages/contracts/schemas.json', import.meta.url)),
};

/**
 * Serialises a document exactly as it is committed.
 * @param {unknown} document
 */
export function serialise(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Writes openapi.json and schemas.json, or with `check` reports whether they are stale.
 * @param {{ check: boolean }} options
 * @returns {Promise<string[]>} Files that are (or were) out of date.
 */
export async function generate({ check }) {
  const outputs = [
    [GENERATED.openapi, serialise(buildOpenApi())],
    [GENERATED.schemas, serialise(buildSchemaSnapshot())],
  ];
  const stale = [];
  for (const [path, content] of outputs) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed paths from GENERATED
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current === content) continue;
    stale.push(path);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed paths from GENERATED
    if (!check) await writeFile(path, content);
  }
  return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const stale = await generate({ check });
  for (const path of stale) {
    process.stdout.write(`${check ? 'stale' : 'wrote'}: ${path}\n`);
  }
  if (check && stale.length > 0) {
    process.stderr.write('Generated contracts are out of date: run `pnpm contracts:generate`.\n');
    process.exitCode = 1;
  } else if (stale.length === 0) {
    process.stdout.write('Generated contracts are up to date.\n');
  }
}
