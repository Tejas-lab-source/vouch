// @ts-check
import { describe, expect, it } from 'vitest';
import { createPrng } from '../../scripts/lib/prng.js';
import { uuidv7, uuidv7From } from '../../scripts/lib/uuidv7.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 UUIDs', () => {
    for (let i = 0; i < 100; i += 1) expect(uuidv7()).toMatch(UUID_V7);
  });

  it('encodes the timestamp in the first 48 bits, so ids sort by time', () => {
    const random = new Uint8Array(10).fill(0xff);
    const ts = Date.UTC(2026, 10, 21);
    const id = uuidv7From(ts, random);

    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(ts);
    expect(uuidv7From(ts, random) < uuidv7From(ts + 1, new Uint8Array(10))).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const random = Uint8Array.from({ length: 10 }, (_, i) => i * 17);
    expect(uuidv7From(1_700_000_000_000, random)).toBe(uuidv7From(1_700_000_000_000, random));
  });

  it('rejects invalid timestamps and short random input', () => {
    expect(() => uuidv7From(-1, new Uint8Array(10))).toThrow(RangeError);
    expect(() => uuidv7From(2 ** 48, new Uint8Array(10))).toThrow(RangeError);
    expect(() => uuidv7From(0, new Uint8Array(9))).toThrow(RangeError);
  });
});

describe('createPrng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    expect(Array.from({ length: 50 }, a.next)).toEqual(Array.from({ length: 50 }, b.next));
  });

  it('stays within the requested integer range', () => {
    const prng = createPrng(7);
    for (let i = 0; i < 1000; i += 1) {
      const n = prng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});
