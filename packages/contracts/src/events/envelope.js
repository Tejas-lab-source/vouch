// @ts-check
import { z } from 'zod';
import { Timestamp } from '../common/ids.js';

/** Event names are `noun.verb.vN`. */
export const EVENT_NAME = /^[a-z]+\.[a-z_]+\.v[1-9][0-9]*$/;

/**
 * @typedef {object} EventDefinition
 * @property {string} name  Full name including the version, for example `user.created.v1`.
 * @property {number} version
 * @property {string} producer  Owning module; the only module that may emit it.
 * @property {string} description
 * @property {z.ZodObject} payload
 * @property {z.ZodObject} envelope  The full envelope with this payload.
 */

/**
 * Defines a domain event and its envelope `{ id, name, version, occurredAt, traceId, payload }`.
 * `id` is the `platform.outbox` row id; consumers deduplicate on `(consumer, id)`.
 * @param {{ name: string, producer: string, description: string, payload: z.ZodObject }} input
 * @returns {Readonly<EventDefinition>}
 */
export function defineEvent({ name, producer, description, payload }) {
  if (!EVENT_NAME.test(name)) throw new Error(`event name must be noun.verb.vN: ${name}`);
  const version = Number(name.slice(name.lastIndexOf('.v') + 2));
  const envelope = z.strictObject({
    id: z.int().min(1).describe('platform.outbox id.'),
    name: z.literal(name),
    version: z.literal(version),
    occurredAt: Timestamp,
    traceId: z.string().max(100).nullable(),
    payload,
  });
  return Object.freeze({ name, version, producer, description, payload, envelope });
}
