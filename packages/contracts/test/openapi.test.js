// @ts-check
import { readFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../src/index.js';
import { buildOpenApi, buildSchemaSnapshot } from '../tooling/index.js';

const OPENAPI_PATH = new URL('../openapi.json', import.meta.url);
const SCHEMAS_PATH = new URL('../schemas.json', import.meta.url);

/** @param {unknown} document */
const serialise = (document) => `${JSON.stringify(document, null, 2)}\n`;

describe('generated OpenAPI', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const api = /** @type {any} */ (
      await SwaggerParser.validate(/** @type {any} */ (structuredClone(buildOpenApi())))
    );
    expect(api.openapi).toBe('3.1.0');
  });

  it('has one operation per endpoint, with matching operation ids', () => {
    const doc = /** @type {any} */ (buildOpenApi());
    const operationIds = Object.values(doc.paths).flatMap((item) =>
      Object.values(/** @type {object} */ (item)).map((op) => op.operationId),
    );
    expect(operationIds.sort()).toEqual(ENDPOINTS.map((endpoint) => endpoint.id).sort());
  });

  it('documents the idempotency key of every POST', () => {
    const doc = /** @type {any} */ (buildOpenApi());
    for (const item of Object.values(doc.paths)) {
      const post = /** @type {any} */ (item).post;
      if (!post) continue;
      expect(['header', 'body', 'path']).toContain(post['x-idempotency'].mode);
      if (post['x-idempotency'].mode === 'header') {
        expect(post.parameters.map((/** @type {any} */ p) => p.name)).toContain('idempotency-key');
      }
    }
  });

  it('matches the committed openapi.json and schemas.json (run `pnpm contracts:generate`)', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed package paths
    expect(await readFile(OPENAPI_PATH, 'utf8')).toBe(serialise(buildOpenApi()));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed package paths
    expect(await readFile(SCHEMAS_PATH, 'utf8')).toBe(serialise(buildSchemaSnapshot()));
  });
});
