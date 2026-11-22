// @ts-check
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { formatCode } from '../../domain/otp.js';

/**
 * Cryptographic primitives for identity, keyed by the server secret.
 * @param {{ emailHmacSecret: string }} options
 * @returns {import('../../ports.js').IdentityCrypto}
 */
export function createIdentityCrypto({ emailHmacSecret }) {
  return {
    hmacEmail: (address) => createHmac('sha256', emailHmacSecret).update(address).digest(),
    hashCode: (emailHmac, code) =>
      createHmac('sha256', emailHmacSecret)
        .update(emailHmac)
        .update(':')
        .update(code)
        .digest('base64url'),
    hashToken: (token) => createHash('sha256').update(token).digest(),
    safeEqual: (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)),
    randomCode: () => formatCode(randomInt(0, 1_000_000)),
    randomToken: () => randomBytes(32).toString('base64url'),
    randomPublicId: () => randomBytes(16).toString('base64url'),
  };
}
