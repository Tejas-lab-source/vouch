// @ts-check
import { ErrorEnvelope } from '../src/common/errors.js';
import { ENDPOINTS, statusOf } from '../src/http/index.js';
import { toJsonSchema } from './json-schema.js';

/** @typedef {import('./json-schema.js').JsonSchema} JsonSchema */

const ERROR_REF = { $ref: '#/components/schemas/ErrorEnvelope' };

/** @type {Record<string, object[]>} */
const SECURITY = {
  public: [],
  optional: [{}, { userBearer: [] }],
  user: [{ userBearer: [] }],
  admin: [{ adminBearer: [] }],
};

/**
 * Turns an object schema's properties into OpenAPI parameters.
 * @param {JsonSchema | undefined} schema
 * @param {'path' | 'query' | 'header'} location
 * @returns {object[]}
 */
function parameters(schema, location) {
  if (!schema) return [];
  const properties = /** @type {Record<string, JsonSchema>} */ (schema.properties ?? {});
  const required = new Set(/** @type {string[]} */ (schema.required ?? []));
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: location,
      required: location === 'path' || required.has(name),
      ...(description ? { description } : {}),
      schema: rest,
    };
  });
}

/**
 * Groups an endpoint's error codes by HTTP status as OpenAPI responses.
 * @param {string[]} codes
 * @returns {Record<string, object>}
 */
function errorResponses(codes) {
  /** @type {Map<number, string[]>} */
  const byStatus = new Map();
  for (const code of codes) {
    const status = statusOf(code);
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return Object.fromEntries(
    [...byStatus.entries()]
      .sort(([a], [b]) => a - b)
      .map(([status, list]) => [
        String(status),
        {
          description: `Error codes: ${list.join(', ')}.`,
          content: { 'application/json': { schema: ERROR_REF } },
        },
      ]),
  );
}

/**
 * Builds the OpenAPI 3.1 document for every v1 REST endpoint from the zod contracts.
 * @returns {Record<string, unknown>}
 */
export function buildOpenApi() {
  /** @type {Record<string, Record<string, object>>} */
  const paths = {};

  for (const endpoint of ENDPOINTS) {
    const operation = {
      operationId: endpoint.id,
      summary: endpoint.summary,
      ...(endpoint.description ? { description: endpoint.description } : {}),
      tags: [endpoint.module],
      security: SECURITY[endpoint.auth],
      'x-idempotency': {
        mode: endpoint.idempotency,
        ...(endpoint.idempotencyField ? { field: endpoint.idempotencyField } : {}),
      },
      'x-error-codes': endpoint.errors,
      parameters: [
        ...parameters(endpoint.params && toJsonSchema(endpoint.params, 'input'), 'path'),
        ...parameters(endpoint.query && toJsonSchema(endpoint.query, 'input'), 'query'),
        ...parameters(toJsonSchema(endpoint.headers, 'input'), 'header'),
      ],
      ...(endpoint.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toJsonSchema(endpoint.body, 'input') } },
            },
          }
        : {}),
      responses: {
        [String(endpoint.response.status)]: {
          description: endpoint.summary,
          content: {
            'application/json': { schema: toJsonSchema(endpoint.response.schema, 'output') },
          },
        },
        ...errorResponses(endpoint.errors),
      },
    };
    const pathItem = paths[endpoint.path] ?? {};
    pathItem[endpoint.method.toLowerCase()] = operation;
    paths[endpoint.path] = pathItem;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Vouch API',
      version: '1.0.0',
      description:
        'Generated from packages/contracts. Do not edit by hand: run `pnpm contracts:generate`. ' +
        'Every request sends X-App-Version; POSTs send Idempotency-Key unless x-idempotency says ' +
        'otherwise. Clients must ignore unknown response fields.',
    },
    tags: [...new Set(ENDPOINTS.map((endpoint) => endpoint.module))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        userBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '15-minute EdDSA access token (user audience).',
        },
        adminBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Admin-audience access token with MFA.',
        },
      },
      schemas: { ErrorEnvelope: toJsonSchema(ErrorEnvelope, 'output') },
    },
  };
}
