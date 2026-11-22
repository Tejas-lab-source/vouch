// @ts-check

/**
 * HMAC-SHA1, injected so the domain stays free of I/O and platform modules.
 * @typedef {(key: Buffer, message: Buffer) => Buffer} HmacSha1
 */

/** RFC 6238 parameters: SHA-1, 30-second steps, 6 digits (what authenticator apps expect). */
export const TOTP = Object.freeze({ stepSeconds: 30, digits: 6, window: 1 });
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** @param {Buffer} bytes */
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

/** @param {string} text */
export function base32Decode(text) {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  /** @type {number[]} */
  const out = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * The HOTP value (RFC 4226) for one counter, as a zero-padded string.
 * @param {HmacSha1} hmacSha1
 * @param {Buffer} secret
 * @param {number} counter
 * @param {number} [digits]
 */
export function hotp(hmacSha1, secret, counter, digits = TOTP.digits) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = hmacSha1(secret, message);
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

/** The TOTP time step for a moment. @param {Date} at */
export const stepAt = (at) => Math.floor(at.getTime() / 1000 / TOTP.stepSeconds);

/**
 * Checks a code against the current step ±1 (clock drift). Returns the matching step, so the
 * caller can refuse a step already used (replay), or null.
 * @param {Buffer} secret
 * @param {string} code
 * @param {Date} at
 * @param {{ safeEqual: (a: string, b: string) => boolean, hmacSha1: HmacSha1 }} crypto
 */
export function verifyTotp(secret, code, at, { safeEqual, hmacSha1 }) {
  const now = stepAt(at);
  /** @type {number | null} */
  let matched = null;
  // Every candidate is computed and compared, so timing does not reveal which step matched.
  for (let step = now - TOTP.window; step <= now + TOTP.window; step += 1) {
    if (safeEqual(hotp(hmacSha1, secret, step), code) && matched === null) matched = step;
  }
  return matched;
}

/**
 * The `otpauth://` URI an authenticator app scans (shown once by `admin:create`).
 * @param {{ secret: Buffer, account: string, issuer?: string }} input
 */
export function otpauthUri({ secret, account, issuer = 'Vouch Admin' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP.digits),
    period: String(TOTP.stepSeconds),
  });
  return `otpauth://totp/${label}?${params}`;
}
