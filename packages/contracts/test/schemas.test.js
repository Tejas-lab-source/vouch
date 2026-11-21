// @ts-check
import { describe, expect, it } from 'vitest';
import { httpFixtures } from './fixtures/http.js';
import {
  commonFixtures,
  envFixtures,
  eventFixtures,
  jobFixtures,
  pipelineFixtures,
  socketFixtures,
} from './fixtures/other.js';
import { allSchemas } from './registry.js';

const FIXTURES = new Map(
  Object.entries({
    ...httpFixtures,
    ...socketFixtures,
    ...eventFixtures,
    ...jobFixtures,
    ...pipelineFixtures,
    ...commonFixtures,
    ...envFixtures,
  }),
);

const SCHEMAS = allSchemas();

describe('contract fixtures', () => {
  it('cover every schema exactly, with at least one valid and one invalid example each', () => {
    expect([...FIXTURES.keys()].sort()).toEqual([...SCHEMAS.keys()].sort());
    for (const [key, fixture] of FIXTURES) {
      expect(fixture.valid.length, `${key} valid`).toBeGreaterThan(0);
      expect(fixture.invalid.length, `${key} invalid`).toBeGreaterThan(0);
    }
  });

  describe.each([...SCHEMAS.entries()])('%s', (key, { schema }) => {
    const fixture = FIXTURES.get(key) ?? { valid: [], invalid: [] };

    it('parses every valid example', () => {
      for (const example of fixture.valid) {
        const result = schema.safeParse(example);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      }
    });

    it('rejects every invalid example', () => {
      for (const example of fixture.invalid) {
        expect(schema.safeParse(example).success, JSON.stringify(example)).toBe(false);
      }
    });
  });
});
