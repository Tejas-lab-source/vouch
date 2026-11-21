// @ts-check
import { describe, expect, it } from 'vitest';
import { createIdGenerator, uuidv7, uuidv7From } from '../../src/platform/ids.js';
import { fixedClock } from '../../src/platform/clock.js';

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

describe('createIdGenerator (newId)', () => {
  it('uses the injected clock for the timestamp part', () => {
    const at = new Date('2026-11-21T10:00:00Z');
    const newId = createIdGenerator({ clock: fixedClock(at) });
    const id = newId();

    expect(id).toMatch(UUID_V7);
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(at.getTime());
  });

  it('returns a different id on every call, even at the same instant', () => {
    const newId = createIdGenerator({ clock: fixedClock(new Date()) });
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});
