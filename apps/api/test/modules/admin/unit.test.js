// @ts-check
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdminCrypto } from '../../../src/modules/admin/adapters/crypto/node-crypto.js';
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  stepAt,
  verifyTotp,
} from '../../../src/modules/admin/domain/totp.js';

const hmacSha1 = (/** @type {Buffer} */ key, /** @type {Buffer} */ message) =>
  createHmac('sha1', key).update(message).digest();
const crypto = createAdminCrypto({
  totpKey: Buffer.alloc(32, 9),
  emailHmacSecret: 'e'.repeat(32),
});

describe('TOTP (RFC 6238, SHA-1)', () => {
  // RFC 6238 Appendix B: secret "12345678901234567890", 8-digit codes; 6-digit codes are the
  // same value modulo 10^6 (RFC 4226 truncation).
  const secret = Buffer.from('12345678901234567890');
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(vectors)('T = %i s gives %s', (seconds, code) => {
    const step = stepAt(new Date(Number(seconds) * 1000));
    expect(hotp(hmacSha1, secret, step, 8)).toBe(code);
    expect(hotp(hmacSha1, secret, step)).toBe(String(code).slice(2));
  });

  it('accepts the current step and one either side, and returns the matched step', () => {
    const at = new Date(1111111111 * 1000);
    const now = stepAt(at);
    for (const offset of [-1, 0, 1]) {
      const code = hotp(hmacSha1, secret, now + offset);
      expect(verifyTotp(secret, code, at, crypto)).toBe(now + offset);
    }
    expect(verifyTotp(secret, hotp(hmacSha1, secret, now + 2), at, crypto)).toBeNull();
    expect(verifyTotp(secret, '000000', at, crypto)).toBeNull();
  });

  it('base32 round-trips (RFC 4648 vector) and builds an otpauth URI', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const random = crypto.newTotpSecret();
    expect(base32Decode(base32Encode(random))).toEqual(random);
    const uri = otpauthUri({ secret, account: 'Asha' });
    expect(uri).toMatch(/^otpauth:\/\/totp\/Vouch%20Admin%3AAsha\?secret=GEZDGNBVGY3TQOJQ/);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('admin crypto', () => {
  it('scrypt hashes verify, never store the password, and differ per salt', async () => {
    const hash = await crypto.hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain('horse');
    expect(await crypto.verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await crypto.verifyPassword('wrong horse battery staple', hash)).toBe(false);
    expect(await crypto.hashPassword('correct horse battery staple')).not.toBe(hash);
    expect(await crypto.verifyPassword('anything', null)).toBe(false);
  });

  it('TOTP secrets are sealed with AES-256-GCM; tampering or another key fails', () => {
    const secret = crypto.newTotpSecret();
    const sealed = crypto.encryptSecret(secret);
    expect(sealed.includes(secret)).toBe(false);
    expect(crypto.decryptSecret(sealed)).toEqual(secret);
    const tampered = Buffer.from(sealed);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
    expect(() => crypto.decryptSecret(tampered)).toThrow();
    const other = createAdminCrypto({
      totpKey: Buffer.alloc(32, 1),
      emailHmacSecret: 'x'.repeat(32),
    });
    expect(() => other.decryptSecret(sealed)).toThrow();
    const none = createAdminCrypto({ totpKey: null, emailHmacSecret: 'x'.repeat(32) });
    expect(() => none.encryptSecret(secret)).toThrow(/ADMIN_TOTP_KEY/);
  });

  it('the email HMAC ignores case and surrounding spaces', () => {
    expect(crypto.hmacEmail(' Asha@Example.com ')).toEqual(crypto.hmacEmail('asha@example.com'));
  });
});
