// @ts-check
import { z } from 'zod';
import { ERROR_STATUS } from '../src/common/errors.js';
import { ConfigResponse } from '../src/config/index.js';
import { EVENTS } from '../src/events/index.js';
import { ENDPOINTS } from '../src/http/index.js';
import { JOBS } from '../src/jobs/index.js';
import { PIPELINES } from '../src/pipelines/index.js';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../src/socket/index.js';

/** @typedef {Record<string, unknown>} JsonSchema */

/**
 * Converts a zod schema to JSON Schema (draft 2020-12, as used by OpenAPI 3.1).
 * `input` describes what the receiver accepts (defaults make fields optional);
 * `output` describes what the sender emits.
 * @param {z.ZodType} schema
 * @param {'input' | 'output'} io
 * @returns {JsonSchema}
 */
export function toJsonSchema(schema, io) {
  const json = /** @type {JsonSchema} */ (z.toJSONSchema(schema, { io, unrepresentable: 'any' }));
  delete json.$schema;
  return json;
}

/**
 * Builds the machine-readable snapshot of every contract. The contract-diff check compares
 * this snapshot with the one on `main`.
 * @returns {JsonSchema}
 */
export function buildSchemaSnapshot() {
  const http = Object.fromEntries(
    ENDPOINTS.map((endpoint) => [
      endpoint.id,
      {
        module: endpoint.module,
        method: endpoint.method,
        path: endpoint.path,
        auth: endpoint.auth,
        idempotency: endpoint.idempotency,
        ...(endpoint.idempotencyField ? { idempotencyField: endpoint.idempotencyField } : {}),
        status: endpoint.response.status,
        errors: endpoint.errors,
        request: {
          headers: toJsonSchema(endpoint.headers, 'input'),
          ...(endpoint.params ? { params: toJsonSchema(endpoint.params, 'input') } : {}),
          ...(endpoint.query ? { query: toJsonSchema(endpoint.query, 'input') } : {}),
          ...(endpoint.body ? { body: toJsonSchema(endpoint.body, 'input') } : {}),
        },
        response: toJsonSchema(endpoint.response.schema, 'output'),
      },
    ]),
  );

  const clientToServer = Object.fromEntries(
    Object.entries(CLIENT_EVENTS).map(([name, event]) => [
      name,
      {
        payload: toJsonSchema(event.payload, 'input'),
        ...(event.ack ? { ack: toJsonSchema(event.ack, 'output') } : {}),
      },
    ]),
  );
  const serverToClient = Object.fromEntries(
    Object.entries(SERVER_EVENTS).map(([name, event]) => [
      name,
      { payload: toJsonSchema(event.payload, 'output') },
    ]),
  );

  return {
    errors: { ...ERROR_STATUS },
    http,
    socket: { clientToServer, serverToClient },
    events: Object.fromEntries(
      Object.values(EVENTS).map((event) => [
        event.name,
        { producer: event.producer, payload: toJsonSchema(event.payload, 'output') },
      ]),
    ),
    jobs: Object.fromEntries(
      Object.values(JOBS).map((job) => [
        job.name,
        { queue: job.queue, payload: toJsonSchema(job.payload, 'input') },
      ]),
    ),
    pipelines: Object.fromEntries(
      Object.values(PIPELINES).map((pipeline) => [
        pipeline.name,
        {
          owner: pipeline.owner,
          failClosed: pipeline.failClosed,
          input: toJsonSchema(pipeline.input, 'input'),
          output: toJsonSchema(pipeline.output, 'output'),
        },
      ]),
    ),
    config: toJsonSchema(ConfigResponse, 'output'),
  };
}
