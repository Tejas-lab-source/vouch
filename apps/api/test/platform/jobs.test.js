// @ts-check
import { describe, expect, it } from 'vitest';
import { backoffDelay, QUEUE_POLICIES } from '../../src/platform/jobs.js';

describe('backoffDelay', () => {
  const policy = { baseDelayMs: 1000, maxDelayMs: 10_000 };

  it('grows exponentially up to the cap (with random = 1)', () => {
    const almostOne = () => 0.999999;
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, policy, almostOne))).toEqual([
      999, 1999, 3999, 7999, 9999, 9999,
    ]);
  });

  it('applies full jitter between 0 and the ceiling', () => {
    expect(backoffDelay(3, policy, () => 0)).toBe(0);
    expect(backoffDelay(3, policy, () => 0.5)).toBe(2000);
  });

  it('defines a policy for every queue class and for event consumers', () => {
    expect(Object.keys(QUEUE_POLICIES).sort()).toEqual([
      'bulk',
      'events',
      'external',
      'fast',
      'media',
    ]);
  });
});
