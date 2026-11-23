// @ts-check
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from '@babel/core';
import { describe, expect, it } from 'vitest';

/**
 * Phase 14 accessibility pass (mobile, static): every interactive or image element in the app
 * and in ui-native has an accessible name, so VoiceOver and TalkBack announce it. Runs on the
 * JSX source (no device needed); the device pass is in the owner's manual checks.
 */
const ROOTS = [
  fileURLToPath(new URL('../src', import.meta.url)),
  fileURLToPath(new URL('../../../packages/ui-native/src', import.meta.url)),
];
/** Element → the props that give it an accessible name (any one is enough). */
const NAMED_BY = new Map([
  ['Pressable', ['accessibilityLabel']],
  ['Switch', ['accessibilityLabel']],
  ['TextInput', ['accessibilityLabel']],
  ['Image', ['accessibilityLabel', 'accessible']],
]);

/** @param {string} dir @returns {string[]} */
const jsxFiles = (dir) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- source tree walk
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- source tree walk
    if (statSync(path).isDirectory()) return jsxFiles(path);
    return name.endsWith('.jsx') ? [path] : [];
  });

/** @param {any} node @param {(node: any) => void} visit */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value === 'object' && typeof value.type === 'string')
      walk(value, visit);
  }
}

describe('mobile accessibility (Phase 14)', () => {
  it('every Pressable, Switch, TextInput and Image has an accessible name', () => {
    /** @type {string[]} */
    const unnamed = [];
    let checked = 0;
    for (const file of ROOTS.flatMap(jsxFiles)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- source tree walk
      const ast = parseSync(readFileSync(file, 'utf8'), {
        filename: file,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['jsx'] },
      });
      walk(ast, (node) => {
        if (node.type !== 'JSXOpeningElement' || node.name.type !== 'JSXIdentifier') return;
        const needs = NAMED_BY.get(node.name.name);
        if (!needs) return;
        checked += 1;
        const props = node.attributes
          .filter((/** @type {any} */ a) => a.type === 'JSXAttribute')
          .map((/** @type {any} */ a) => a.name.name);
        if (!needs.some((p) => props.includes(p))) {
          unnamed.push(`${file.split('/src/').at(-1)}:${node.loc.start.line} <${node.name.name}>`);
        }
      });
    }
    expect(checked).toBeGreaterThan(10);
    expect(unnamed).toEqual([]);
  });
});
