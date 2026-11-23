// @ts-check

/**
 * A counting semaphore: at most `size` holders at once; others wait in FIFO order.
 * @param {number} size
 */
export function createSemaphore(size) {
  if (!Number.isInteger(size) || size < 1) throw new Error('semaphore size must be >= 1');
  let held = 0;
  /** @type {(() => void)[]} */
  const waiting = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else held -= 1;
  };
  return {
    /**
     * Runs `fn` while holding one slot.
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async run(fn) {
      if (held < size) held += 1;
      else await new Promise((resolve) => waiting.push(() => resolve(undefined)));
      try {
        return await fn();
      } finally {
        release();
      }
    },
    /** Slots in use (for tests). */
    get held() {
      return held;
    },
  };
}
