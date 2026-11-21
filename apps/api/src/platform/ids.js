// @ts-check
import { randomBytes } from 'node:crypto';

const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

/**
 * Builds a UUIDv7 (RFC 9562) from a millisecond timestamp and 10 random bytes.
 * Pure, so callers that need determinism (the seed, tests) can supply both inputs.
 * @param {number} timestampMs  Unix time in milliseconds, 0 to 2^48 - 1.
 * @param {Uint8Array} random  At least 10 bytes; only the first 10 are used.
 * @returns {string} Lower-case canonical UUID string.
 */
export function uuidv7From(timestampMs, random) {
  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > MAX_TIMESTAMP_MS) {
    throw new RangeError('timestampMs must be an integer between 0 and 2^48 - 1');
  }
  if (random.length < 10) throw new RangeError('random must hold at least 10 bytes');

  const bytes = new Uint8Array(16);
  let ts = timestampMs;
  for (let i = 5; i >= 0; i -= 1) {
    bytes.set([ts % 256], i);
    ts = Math.floor(ts / 256);
  }
  bytes.set(random.subarray(0, 10), 6);
  bytes.set([0x70 | ((random.at(0) ?? 0) & 0x0f)], 6); // version 7
  bytes.set([0x80 | ((random.at(2) ?? 0) & 0x3f)], 8); // RFC 9562 variant

  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generates a UUIDv7 for the current time with cryptographic randomness.
 * @param {number} [nowMs]
 * @returns {string}
 */
export function uuidv7(nowMs = Date.now()) {
  return uuidv7From(nowMs, randomBytes(10));
}

/**
 * Creates the injected `newId` used everywhere in the backend. Time comes from the clock,
 * so tests can pin it; randomness is always cryptographic.
 * @param {{ clock: import('./clock.js').Clock }} deps
 * @returns {() => string}
 */
export function createIdGenerator({ clock }) {
  return () => uuidv7(clock.now().getTime());
}
