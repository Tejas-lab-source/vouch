// @ts-check
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

/** scrypt cost: N = 2^15, r = 8, p = 1 (about 32 MB and tens of milliseconds per hash). */
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 });

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} keyLength
 * @param {{ N: number, r: number, p: number, maxmem: number }} options
 * @returns {Promise<Buffer>}
 */
const scryptAsync = (password, salt, keyLength, options) =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

/**
 * Admin crypto with `node:crypto` only: scrypt password hashes, AES-256-GCM for TOTP secrets
 * at rest, the email HMAC (same secret and normalisation as identity: trimmed, lowercased) and
 * constant-time comparison.
 * @param {{ totpKey: Buffer | null, emailHmacSecret: string }} options
 */
export function createAdminCrypto({ totpKey, emailHmacSecret }) {
  /** @param {string} a @param {string} b */
  const safeEqual = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const requireKey = () => {
    if (!totpKey || totpKey.length !== 32) throw new Error('ADMIN_TOTP_KEY is not configured');
    return totpKey;
  };

  return {
    safeEqual,
    /** @param {Buffer} key @param {Buffer} message */
    hmacSha1: (key, message) => createHmac('sha1', key).update(message).digest(),
    /** @param {string} email */
    hmacEmail: (email) =>
      createHmac('sha256', emailHmacSecret).update(email.trim().toLowerCase()).digest(),
    /** @param {string} password */
    async hashPassword(password) {
      const salt = randomBytes(16);
      const hash = await scryptAsync(password, salt, SCRYPT.keyLength, SCRYPT);
      return [
        'scrypt',
        SCRYPT.N,
        SCRYPT.r,
        SCRYPT.p,
        salt.toString('base64'),
        hash.toString('base64'),
      ].join('$');
    },
    /**
     * Verifies a password. With no stored hash it still does the same work, so a missing
     * account takes as long as a wrong password.
     * @param {string} password
     * @param {string | null} stored
     */
    async verifyPassword(password, stored) {
      const [scheme, n, r, p, salt, hash] = (stored ?? '').split('$');
      const valid = scheme === 'scrypt' && Boolean(salt) && Boolean(hash);
      const saltBytes = valid ? Buffer.from(String(salt), 'base64') : randomBytes(16);
      const expected = valid ? Buffer.from(String(hash), 'base64') : randomBytes(SCRYPT.keyLength);
      const actual = await scryptAsync(password, saltBytes, expected.length, {
        N: valid ? Number(n) : SCRYPT.N,
        r: valid ? Number(r) : SCRYPT.r,
        p: valid ? Number(p) : SCRYPT.p,
        maxmem: SCRYPT.maxmem,
      });
      return valid && timingSafeEqual(actual, expected);
    },
    /** A new random TOTP secret (20 bytes, the RFC 4226 recommendation). */
    newTotpSecret: () => randomBytes(20),
    /** @param {Buffer} secret  Sealed as iv (12) ‖ tag (16) ‖ ciphertext. */
    encryptSecret(secret) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', requireKey(), iv);
      const body = Buffer.concat([cipher.update(secret), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    /** @param {Buffer} sealed */
    decryptSecret(sealed) {
      const decipher = createDecipheriv('aes-256-gcm', requireKey(), sealed.subarray(0, 12));
      decipher.setAuthTag(sealed.subarray(12, 28));
      return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
    },
  };
}

/** @typedef {ReturnType<typeof createAdminCrypto>} AdminCrypto */
