// @ts-check
/* eslint-disable security/detect-object-injection -- walks trusted, build-time JSON Schema
   snapshots by key; no user input reaches this module. */

/**
 * Contract diff: finds breaking changes between two schema snapshots (see json-schema.js).
 *
 * Rules (docs/adr/0007-contract-versioning.md):
 * - Anything a client or consumer relies on may not disappear: endpoints, events, socket
 *   events, jobs, pipelines, error codes, fields.
 * - `input` schemas (what a receiver accepts: requests, client socket events, jobs, pipeline
 *   inputs) may not narrow: no removed field, no new required field, no stricter type, enum,
 *   length, range, pattern or format.
 * - `output` schemas (what a sender emits: responses, acks, server events, domain events,
 *   config) may not remove a field, make a required field optional, change a type, or remove
 *   an enum value or union option. Adding enum values is allowed: clients ignore unknowns.
 */

/** @typedef {Record<string, any>} Schema */
/** @typedef {'input' | 'output'} Mode */
/** @typedef {{ path: string, message: string }} BreakingChange */

const AUTH_RANK = new Map([
  ['public', 0],
  ['optional', 1],
  ['user', 2],
  ['admin', 3],
]);

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The set of JSON types a schema declares, or null when it declares none.
 * @param {Schema} schema
 * @returns {Set<string> | null}
 */
function types(schema) {
  if (schema.type === undefined) return null;
  return new Set(Array.isArray(schema.type) ? schema.type : [schema.type]);
}

/**
 * True when every old type is still accepted by the new set.
 * @param {Set<string>} oldTypes
 * @param {Set<string>} newTypes
 */
function typesKept(oldTypes, newTypes) {
  return [...oldTypes].every(
    (type) => newTypes.has(type) || (type === 'integer' && newTypes.has('number')),
  );
}

/**
 * Compares numeric/string/array bounds for input schemas.
 * @param {Schema} before
 * @param {Schema} after
 * @param {string} path
 * @param {BreakingChange[]} out
 */
function compareBounds(before, after, path, out) {
  /** @type {[string, 'min' | 'max'][]} */
  const bounds = [
    ['minLength', 'min'],
    ['maxLength', 'max'],
    ['minimum', 'min'],
    ['maximum', 'max'],
    ['exclusiveMinimum', 'min'],
    ['exclusiveMaximum', 'max'],
    ['minItems', 'min'],
    ['maxItems', 'max'],
  ];
  for (const [key, kind] of bounds) {
    const oldValue = before[key];
    const newValue = after[key];
    if (newValue === undefined) continue;
    if (oldValue === undefined || (kind === 'min' ? newValue > oldValue : newValue < oldValue)) {
      out.push({ path, message: `${key} narrowed from ${oldValue ?? 'none'} to ${newValue}` });
    }
  }
  if (after.pattern !== undefined && after.pattern !== before.pattern) {
    out.push({ path, message: 'pattern changed' });
  }
  if (after.format !== undefined && after.format !== before.format) {
    out.push({ path, message: `format changed to ${after.format}` });
  }
}

/**
 * Recursively compares two JSON Schemas and records breaking changes.
 * @param {Schema | undefined} before
 * @param {Schema | undefined} after
 * @param {Mode} mode
 * @param {string} path
 * @param {BreakingChange[]} out
 */
export function compareSchemas(before, after, mode, path, out) {
  if (!before) return;
  if (!after) {
    out.push({ path, message: 'removed' });
    return;
  }

  if (before.const !== undefined && !same(before.const, after.const)) {
    out.push({ path, message: `const changed from ${JSON.stringify(before.const)}` });
  }

  if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
    const removed = before.enum.filter(
      (value) => !after.enum.some((/** @type {unknown} */ v) => same(v, value)),
    );
    if (removed.length > 0)
      out.push({ path, message: `enum values removed: ${removed.join(', ')}` });
  } else if (before.enum === undefined && Array.isArray(after.enum) && mode === 'input') {
    out.push({ path, message: 'enum added (narrowed)' });
  }

  const oldTypes = types(before);
  const newTypes = types(after);
  if (oldTypes && newTypes && !typesKept(oldTypes, newTypes)) {
    out.push({ path, message: `type changed from ${[...oldTypes]} to ${[...newTypes]}` });
  }

  const oldUnion = before.anyOf ?? before.oneOf;
  const newUnion = after.anyOf ?? after.oneOf;
  if (oldUnion && newUnion) {
    if (newUnion.length < oldUnion.length) out.push({ path, message: 'union option removed' });
    oldUnion.forEach((/** @type {Schema} */ option, /** @type {number} */ i) =>
      compareSchemas(option, newUnion.at(i), mode, `${path}|${i}`, out),
    );
  } else if (oldUnion && !newUnion) {
    out.push({ path, message: 'union replaced by a single schema' });
  }

  if (before.properties) {
    const newProps = after.properties ?? {};
    const oldRequired = new Set(before.required ?? []);
    const newRequired = new Set(after.required ?? []);
    for (const [key, schema] of Object.entries(before.properties)) {
      compareSchemas(schema, newProps[key], mode, `${path}.${key}`, out);
      if (mode === 'output' && oldRequired.has(key) && key in newProps && !newRequired.has(key)) {
        out.push({ path: `${path}.${key}`, message: 'required response field became optional' });
      }
    }
    if (mode === 'input') {
      for (const key of newRequired) {
        if (!oldRequired.has(key))
          out.push({ path: `${path}.${key}`, message: 'new required field' });
      }
    }
  }

  if (typeof before.additionalProperties === 'object') {
    compareSchemas(before.additionalProperties, after.additionalProperties, mode, `${path}{}`, out);
  }
  if (before.items) compareSchemas(before.items, after.items, mode, `${path}[]`, out);
  if (mode === 'input') compareBounds(before, after, path, out);
}

/**
 * Compares two keyed collections of entries with a per-entry comparison.
 * @param {Schema} before
 * @param {Schema} after
 * @param {string} label
 * @param {(oldEntry: Schema, newEntry: Schema, path: string) => void} compareEntry
 * @param {BreakingChange[]} out
 */
function compareCollection(before = {}, after = {}, label, compareEntry, out) {
  for (const [name, entry] of Object.entries(before)) {
    if (!(name in after)) {
      out.push({ path: `${label}.${name}`, message: 'removed or renamed' });
      continue;
    }
    compareEntry(entry, after[name], `${label}.${name}`);
  }
}

/**
 * Finds every breaking change from `before` to `after`.
 * @param {Schema} before  Snapshot on the base branch (main).
 * @param {Schema} after  Snapshot built from the current code.
 * @returns {BreakingChange[]}
 */
export function diffSnapshots(before, after) {
  /** @type {BreakingChange[]} */
  const out = [];

  for (const [code, status] of Object.entries(before.errors ?? {})) {
    const next = after.errors?.[code];
    if (next === undefined) out.push({ path: `errors.${code}`, message: 'error code removed' });
    else if (next !== status)
      out.push({ path: `errors.${code}`, message: `status changed to ${next}` });
  }

  compareCollection(
    before.http,
    after.http,
    'http',
    (a, b, path) => {
      for (const key of ['method', 'path', 'status']) {
        if (a[key] !== b[key])
          out.push({ path: `${path}.${key}`, message: `changed from ${a[key]} to ${b[key]}` });
      }
      if ((AUTH_RANK.get(b.auth) ?? 0) > (AUTH_RANK.get(a.auth) ?? 0)) {
        out.push({ path: `${path}.auth`, message: `auth tightened from ${a.auth} to ${b.auth}` });
      }
      for (const part of ['headers', 'params', 'query', 'body']) {
        compareSchemas(
          a.request?.[part],
          b.request?.[part],
          'input',
          `${path}.request.${part}`,
          out,
        );
        if (!a.request?.[part] && b.request?.[part]?.required?.length) {
          out.push({ path: `${path}.request.${part}`, message: 'new required request part' });
        }
      }
      compareSchemas(a.response, b.response, 'output', `${path}.response`, out);
    },
    out,
  );

  compareCollection(
    before.socket?.clientToServer,
    after.socket?.clientToServer,
    'socket.clientToServer',
    (a, b, path) => {
      compareSchemas(a.payload, b.payload, 'input', `${path}.payload`, out);
      compareSchemas(a.ack, b.ack, 'output', `${path}.ack`, out);
    },
    out,
  );
  compareCollection(
    before.socket?.serverToClient,
    after.socket?.serverToClient,
    'socket.serverToClient',
    (a, b, path) => {
      compareSchemas(a.payload, b.payload, 'output', `${path}.payload`, out);
    },
    out,
  );
  compareCollection(
    before.events,
    after.events,
    'events',
    (a, b, path) => {
      compareSchemas(a.payload, b.payload, 'output', `${path}.payload`, out);
    },
    out,
  );
  compareCollection(
    before.jobs,
    after.jobs,
    'jobs',
    (a, b, path) => {
      compareSchemas(a.payload, b.payload, 'input', `${path}.payload`, out);
    },
    out,
  );
  compareCollection(
    before.pipelines,
    after.pipelines,
    'pipelines',
    (a, b, path) => {
      compareSchemas(a.input, b.input, 'input', `${path}.input`, out);
      compareSchemas(a.output, b.output, 'output', `${path}.output`, out);
    },
    out,
  );
  compareSchemas(before.config, after.config, 'output', 'config', out);

  return out;
}
