// @ts-check
/**
 * Build-time tooling for the contracts: OpenAPI and snapshot generation, and the contract
 * diff. Pure functions; the root scripts/ do the file and git work.
 */
export { compareSchemas, diffSnapshots } from './diff.js';
export { buildSchemaSnapshot, toJsonSchema } from './json-schema.js';
export { buildOpenApi } from './openapi.js';
