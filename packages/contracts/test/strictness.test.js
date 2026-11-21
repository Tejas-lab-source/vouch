// @ts-check
import { describe, expect, it } from 'vitest';
import { toJsonSchema } from '../tooling/index.js';
import { allSchemas } from './registry.js';

/**
 * Collects the paths of object nodes with listed properties that still allow unknown keys.
 * Free-form records (`z.record`, no listed properties) are allowed; each is documented.
 * @param {any} node
 * @param {string} path
 * @param {string[]} out
 * @returns {string[]}
 */
function openObjects(node, path, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child, i) => openObjects(child, `${path}[${i}]`, out));
    return out;
  }
  if (node.properties && node.additionalProperties !== false) out.push(path);
  for (const [key, child] of Object.entries(node)) openObjects(child, `${path}.${key}`, out);
  return out;
}

describe('no pass-through in anything we emit', () => {
  const outputs = [...allSchemas().entries()].filter(([, entry]) => entry.io === 'output');

  it('covers every emitted schema', () => {
    expect(outputs.length).toBeGreaterThan(50);
  });

  it.each(outputs)('%s lists every field (strict objects only)', (_key, { schema }) => {
    // The input form shows strictness: zod reports a stripping object as closed in output mode.
    expect(openObjects(toJsonSchema(schema, 'input'), '')).toEqual([]);
  });
});
