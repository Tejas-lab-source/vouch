// @ts-check
import * as contracts from '../src/index.js';

/**
 * @typedef {object} Entry
 * @property {import('zod').ZodType} schema
 * @property {'input' | 'output'} io  `output`: something we emit, so it must be strict.
 */

/**
 * Every schema in the package, keyed the same way as the fixtures.
 * @returns {Map<string, Entry>}
 */
export function allSchemas() {
  /** @type {Map<string, Entry>} */
  const map = new Map();
  /** @param {string} key @param {import('zod').ZodType} schema @param {'input' | 'output'} io */
  const add = (key, schema, io) => {
    if (map.has(key)) throw new Error(`duplicate schema key ${key}`);
    map.set(key, { schema, io });
  };

  for (const endpoint of contracts.ENDPOINTS) {
    if (endpoint.params) add(`${endpoint.id}.params`, endpoint.params, 'input');
    if (endpoint.query) add(`${endpoint.id}.query`, endpoint.query, 'input');
    if (endpoint.body) add(`${endpoint.id}.body`, endpoint.body, 'input');
    add(`${endpoint.id}.response`, endpoint.response.schema, 'output');
  }
  for (const [name, event] of Object.entries(contracts.CLIENT_EVENTS)) {
    add(`socket.${name}.payload`, event.payload, 'input');
    if (event.ack) add(`socket.${name}.ack`, event.ack, 'output');
  }
  for (const [name, event] of Object.entries(contracts.SERVER_EVENTS)) {
    add(`socket.${name}.payload`, event.payload, 'output');
  }
  for (const event of Object.values(contracts.EVENTS))
    add(`event.${event.name}`, event.envelope, 'output');
  for (const job of Object.values(contracts.JOBS)) add(`job.${job.name}`, job.payload, 'input');
  for (const pipeline of Object.values(contracts.PIPELINES)) {
    add(`pipeline.${pipeline.name}.input`, pipeline.input, 'input');
    add(`pipeline.${pipeline.name}.output`, pipeline.output, 'output');
  }
  add('ErrorEnvelope', contracts.ErrorEnvelope, 'output');
  add('BaseHeaders', contracts.BaseHeaders, 'input');
  add('IdempotentHeaders', contracts.IdempotentHeaders, 'input');
  add('PageQuery', contracts.PageQuery, 'input');
  add('Gender', contracts.Gender, 'input');
  add('InterestedIn', contracts.InterestedIn, 'input');
  add('FlagRule', contracts.FlagRule, 'input');
  add('ConfigResponse', contracts.ConfigResponse, 'output');
  add('SectionDefinitionSchema', contracts.SectionDefinitionSchema, 'input');
  add('EnvSchema', contracts.EnvSchema, 'input');
  return map;
}
