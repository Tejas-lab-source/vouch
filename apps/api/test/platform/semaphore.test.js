// @ts-check
import { describe, expect, it } from 'vitest';
import { createSemaphore } from '../../src/platform/semaphore.js';

describe('semaphore', () => {
  it('runs at most `size` at once, in FIFO order, and frees slots on errors', async () => {
    const slots = createSemaphore(2);
    let running = 0;
    let peak = 0;
    /** @type {number[]} */
    const order = [];
    const task = (/** @type {number} */ i) =>
      slots.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        order.push(i);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running -= 1;
        if (i === 3) throw new Error('boom');
        return i;
      });
    const results = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(task));
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(slots.held).toBe(0);
    expect(() => createSemaphore(0)).toThrow();
  });
});
