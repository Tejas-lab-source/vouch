// @ts-check
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildSchemaSnapshot, diffSnapshots } from '@vouch/contracts/tooling';

const SNAPSHOT_PATH = 'packages/contracts/schemas.json';
const GIT_TIMEOUT_MS = 15_000;

/**
 * Reads the committed contract snapshot at a git ref, or null when the ref has none.
 * @param {string} ref
 * @returns {Record<string, unknown> | null}
 */
export function readBaseSnapshot(ref) {
  try {
    const text = execFileSync('git', ['show', `${ref}:${SNAPSHOT_PATH}`], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(text);
  } catch (err) {
    const stderr = /** @type {{ stderr?: string }} */ (err).stderr ?? '';
    if (/does not exist|exists on disk, but not in|invalid object name/i.test(stderr)) return null;
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { base: { type: 'string', default: 'origin/main' } } });
  const base = values.base ?? 'origin/main';
  const before = readBaseSnapshot(base);
  if (before === null) {
    process.stdout.write(`No contract snapshot on ${base}; nothing to compare (first version).\n`);
  } else {
    const breaking = diffSnapshots(before, buildSchemaSnapshot());
    if (breaking.length === 0) {
      process.stdout.write(`No breaking contract changes against ${base}.\n`);
    } else {
      process.stderr.write(`${breaking.length} breaking contract change(s) against ${base}:\n`);
      for (const change of breaking)
        process.stderr.write(`  ✗ ${change.path}: ${change.message}\n`);
      process.stderr.write('Ship breaking changes as a new version (v2) beside the old one.\n');
      process.exitCode = 1;
    }
  }
}
