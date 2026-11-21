// @ts-check
import { z } from 'zod';

/** Section type name, as stored in `profiles.profile_sections.type`. */
export const SectionType = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/**
 * @typedef {object} SectionDefinition
 * @property {string} type  For example `prompts` (a later feature).
 * @property {number} schemaVersion  Bumped for a breaking change to `data`; old versions stay readable.
 * @property {z.ZodType} data  Schema for the section's `data`.
 * @property {string} owner  Module that registered the section.
 */

/** Shape every section registration must have (manifest key `sections`). */
export const SectionDefinitionSchema = z.strictObject({
  type: SectionType,
  schemaVersion: z.int().min(1),
  data: z.custom((value) => value instanceof z.ZodType, 'data must be a zod schema'),
  owner: z.string().regex(/^[a-z]+$/),
});

/**
 * Validates and freezes a section definition.
 * @param {SectionDefinition} definition
 * @returns {Readonly<SectionDefinition>}
 */
export function defineSection(definition) {
  SectionDefinitionSchema.parse(definition);
  return Object.freeze({ ...definition });
}

/**
 * Registered section types. Empty in v1: unknown types return UNKNOWN_SECTION_TYPE.
 * Hobby interests, prompts and clubs are later features.
 * @type {Readonly<Record<string, Readonly<SectionDefinition>>>}
 */
export const SECTION_TYPES = Object.freeze({});
