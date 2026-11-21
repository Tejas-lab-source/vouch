// @ts-check
import { describe, expect, it } from 'vitest';
import { createPrng } from '../../scripts/lib/prng.js';

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
