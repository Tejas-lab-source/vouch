// @ts-check
import { z } from 'zod';
import { AppErrorCode, ERROR_STATUS } from '../common/errors.js';
import { BaseHeaders, IdempotentHeaders } from '../common/headers.js';

/** @typedef {'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} HttpMethod */
/** @typedef {'public' | 'optional' | 'user' | 'admin'} AuthMode */
/** @typedef {import('../common/errors.js').AppErrorCodeName} ErrorCodeName */

/**
 * @typedef {object} EndpointInput
 * @property {string} id  Unique, camelCase; becomes the OpenAPI operationId.
 * @property {string} module  Owning backend module.
 * @property {HttpMethod} method
 * @property {string} path  Starts with /v1; path params as `{name}`.
 * @property {AuthMode} auth  `optional`: works signed out, richer when signed in.
 * @property {string} summary
 * @property {string} [description]
 * @property {'header' | 'body' | 'path' | 'none'} [idempotency]  POST default: 'header'. 'body' or
 *   'path': a client id in the body, or the resource id in the path, is the idempotency key.
 * @property {string} [idempotencyField]  The body field or path param used as the key.
 * @property {z.ZodObject} [params]
 * @property {z.ZodObject} [query]
 * @property {z.ZodType} [body]
 * @property {{ status: number, schema: z.ZodType }} response
 * @property {ErrorCodeName[]} [errors]  Endpoint-specific error codes.
 */

/**
 * @typedef {EndpointInput & {
 *   idempotency: 'header' | 'body' | 'path' | 'none',
 *   headers: z.ZodObject,
 *   errors: ErrorCodeName[],
 * }} Endpoint
 */

/** Errors any endpoint can return. */
const COMMON_ERRORS = /** @type {ErrorCodeName[]} */ ([
  'VALIDATION_FAILED',
  'APP_VERSION_UNSUPPORTED',
  'RATE_LIMITED',
  'INTERNAL',
]);

/** @type {Record<AuthMode, ErrorCodeName[]>} */
const AUTH_ERRORS = {
  public: [],
  optional: [],
  user: ['UNAUTHENTICATED', 'ACCOUNT_BANNED'],
  admin: ['UNAUTHENTICATED', 'FORBIDDEN', 'MFA_REQUIRED', 'IP_NOT_ALLOWED'],
};

/**
 * Defines one REST endpoint. Throws at import time when the definition is inconsistent.
 * @param {EndpointInput} input
 * @returns {Readonly<Endpoint>}
 */
export function defineEndpoint(input) {
  if (!input.path.startsWith('/v1/')) throw new Error(`${input.id}: path must start with /v1/`);
  const pathParams = [...input.path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();
  const declared = Object.keys(input.params?.shape ?? {}).sort();
  if (pathParams.join() !== declared.join()) {
    throw new Error(`${input.id}: params schema must declare exactly ${pathParams.join(', ')}`);
  }
  const idempotency = input.idempotency ?? (input.method === 'POST' ? 'header' : 'none');
  if (input.method === 'POST' && idempotency === 'none') {
    throw new Error(`${input.id}: every POST must document its idempotency key`);
  }
  if (
    idempotency === 'body' &&
    !Object.hasOwn(objectShape(input.body), input.idempotencyField ?? '')
  ) {
    throw new Error(
      `${input.id}: idempotency 'body' needs an idempotencyField present in the body`,
    );
  }
  if (idempotency === 'path' && !pathParams.includes(input.idempotencyField ?? '')) {
    throw new Error(
      `${input.id}: idempotency 'path' needs an idempotencyField naming a path param`,
    );
  }
  const errors = [
    ...new Set([...COMMON_ERRORS, ...AUTH_ERRORS[input.auth], ...(input.errors ?? [])]),
  ];
  for (const code of errors) AppErrorCode.parse(code);
  if (!(input.response.status >= 200 && input.response.status < 300)) {
    throw new Error(`${input.id}: response.status must be 2xx`);
  }

  return Object.freeze({
    ...input,
    idempotency,
    headers: idempotency === 'header' ? IdempotentHeaders : BaseHeaders,
    errors: errors.sort((a, b) => statusOf(a) - statusOf(b) || a.localeCompare(b)),
  });
}

/**
 * The shape of an object schema, or an empty shape for any other schema.
 * @param {z.ZodType | undefined} schema
 * @returns {Record<string, unknown>}
 */
function objectShape(schema) {
  return schema instanceof z.ZodObject ? schema.shape : {};
}

const STATUS_BY_CODE = new Map(Object.entries(ERROR_STATUS));

/**
 * HTTP status for an error code.
 * @param {string} code
 * @returns {number}
 */
export function statusOf(code) {
  const status = STATUS_BY_CODE.get(code);
  if (status === undefined) throw new Error(`unknown error code: ${code}`);
  return status;
}

/** An empty JSON body, for action endpoints that take no input. */
export const EmptyBody = z.strictObject({});
