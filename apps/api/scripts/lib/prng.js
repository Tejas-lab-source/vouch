// @ts-check

/**
 * @typedef {object} Prng
 * @property {() => number} next  Float in [0, 1).
 * @property {(min: number, max: number) => number} int  Integer in [min, max].
 * @property {<T>(items: readonly T[]) => T} pick  One element of a non-empty array.
 * @property {(length: number) => Uint8Array} bytes  Pseudo-random bytes.
 */

/**
 * Deterministic pseudo-random generator (mulberry32). For synthetic data only; never for
 * secrets, tokens or ids that must be unguessable.
 * @param {number} seed  32-bit integer seed.
 * @returns {Prng}
 */
export function createPrng(seed) {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** @type {Prng['int']} */
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));

  /** @type {Prng['pick']} */
  const pick = (items) => {
    const item = items.at(int(0, items.length - 1));
    if (item === undefined) throw new RangeError('pick needs a non-empty array');
    return item;
  };

  /** @type {Prng['bytes']} */
  const bytes = (length) => Uint8Array.from({ length }, () => int(0, 255));

  return { next, int, pick, bytes };
}
