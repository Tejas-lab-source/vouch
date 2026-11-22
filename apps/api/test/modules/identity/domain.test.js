// @ts-check
import { describe, expect, it } from 'vitest';
import { ageOn, isAdult } from '../../../src/modules/identity/domain/age.js';
import {
  findCollegeForDomain,
  normaliseEmail,
} from '../../../src/modules/identity/domain/email.js';
import {
  formatCode,
  judgeAttempt,
  OTP_MAX_ATTEMPTS,
} from '../../../src/modules/identity/domain/otp.js';
import { judgeRefresh } from '../../../src/modules/identity/domain/session.js';

const COLLEGES = [
  { id: 'c1', emailDomains: ['northfield.example.edu'] },
  { id: 'c2', emailDomains: ['riverside.example.edu', 'rcas.example.edu'] },
];

describe('normaliseEmail', () => {
  it('trims, lowercases and drops a +tag', () => {
    expect(normaliseEmail('  Aditi.R+dating@NorthField.Example.EDU ')).toEqual({
      address: 'aditi.r@northfield.example.edu',
      domain: 'northfield.example.edu',
    });
  });

  it('maps every +tag of one mailbox to the same address', () => {
    const a = normaliseEmail('sam+one@northfield.example.edu');
    const b = normaliseEmail('sam+two@northfield.example.edu');
    expect(a?.address).toBe(b?.address);
  });

  it.each([
    'not-an-email',
    'a@b',
    '@northfield.example.edu',
    '+tag@northfield.example.edu',
    'a b@x.edu',
    'a@@x.edu',
    'a@-x.edu',
    'a@x-.edu',
  ])('rejects %s', (raw) => {
    expect(normaliseEmail(raw)).toBeNull();
  });
});

describe('findCollegeForDomain (exact match only)', () => {
  it('matches a listed domain exactly', () => {
    expect(findCollegeForDomain('northfield.example.edu', COLLEGES)?.id).toBe('c1');
    expect(findCollegeForDomain('rcas.example.edu', COLLEGES)?.id).toBe('c2');
  });

  it('rejects alumni.<college domain> and other subdomains', () => {
    expect(findCollegeForDomain('alumni.northfield.example.edu', COLLEGES)).toBeUndefined();
    expect(findCollegeForDomain('staff.riverside.example.edu', COLLEGES)).toBeUndefined();
  });

  it('rejects look-alike and parent domains', () => {
    expect(findCollegeForDomain('northfield.example.edu.evil.com', COLLEGES)).toBeUndefined();
    expect(findCollegeForDomain('example.edu', COLLEGES)).toBeUndefined();
  });
});

describe('age', () => {
  const today = new Date('2026-11-21T10:00:00Z');

  it('a person whose 18th birthday is today is an adult; one day short is not', () => {
    expect(isAdult('2008-11-21', today)).toBe(true);
    expect(isAdult('2008-11-22', today)).toBe(false);
    expect(ageOn('2008-11-22', today)).toBe(17);
  });

  it('handles leap-day birthdays', () => {
    expect(ageOn('2004-02-29', new Date('2022-02-28T00:00:00Z'))).toBe(17);
    expect(ageOn('2004-02-29', new Date('2022-03-01T00:00:00Z'))).toBe(18);
  });
});

describe('OTP rules', () => {
  it('formats codes as 6 digits, keeping leading zeros', () => {
    expect(formatCode(42)).toBe('000042');
    expect(formatCode(999999)).toBe('999999');
  });

  it('burns the code on the 5th wrong attempt', () => {
    expect(judgeAttempt({ matches: true, attemptsAfter: 0 })).toBe('valid');
    expect(judgeAttempt({ matches: false, attemptsAfter: OTP_MAX_ATTEMPTS - 1 })).toBe('invalid');
    expect(judgeAttempt({ matches: false, attemptsAfter: OTP_MAX_ATTEMPTS })).toBe('exhausted');
  });
});

describe('refresh-token rules', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const future = new Date('2026-12-21T10:00:00Z');

  it('distinguishes valid, rotated (reused), revoked and expired tokens', () => {
    expect(judgeRefresh({ replacedBy: null, revokedAt: null, expiresAt: future }, now)).toBe(
      'valid',
    );
    expect(judgeRefresh({ replacedBy: 's2', revokedAt: now, expiresAt: future }, now)).toBe(
      'reused',
    );
    expect(judgeRefresh({ replacedBy: null, revokedAt: now, expiresAt: future }, now)).toBe(
      'revoked',
    );
    expect(judgeRefresh({ replacedBy: null, revokedAt: null, expiresAt: now }, now)).toBe(
      'expired',
    );
  });

  describe('grace window for retried refreshes', () => {
    const graceMs = 30_000;
    const unused = { replacedBy: null, revokedAt: null, expiresAt: future };
    /** @param {number} secondsAgo */
    const rotated = (secondsAgo) => ({
      replacedBy: 's2',
      revokedAt: new Date(now.getTime() - secondsAgo * 1000),
      expiresAt: future,
    });

    it('a retry within 30 s whose replacement was never used is a retry', () => {
      expect(judgeRefresh(rotated(0), now, { replacement: unused, graceMs })).toBe('retry');
      expect(judgeRefresh(rotated(30), now, { replacement: unused, graceMs })).toBe('retry');
    });

    it('after the window it is reuse', () => {
      const late = { ...rotated(30), revokedAt: new Date(now.getTime() - 30_001) };
      expect(judgeRefresh(late, now, { replacement: unused, graceMs })).toBe('reused');
    });

    it('after the replacement was used (rotated or revoked) it is reuse', () => {
      const used = { ...unused, replacedBy: 's3', revokedAt: now };
      const signedOut = { ...unused, revokedAt: now };
      expect(judgeRefresh(rotated(1), now, { replacement: used, graceMs })).toBe('reused');
      expect(judgeRefresh(rotated(1), now, { replacement: signedOut, graceMs })).toBe('reused');
      expect(judgeRefresh(rotated(1), now, { replacement: null, graceMs })).toBe('reused');
    });

    it('a window of 0 disables retries', () => {
      expect(judgeRefresh(rotated(0), now, { replacement: unused, graceMs: 0 })).toBe('reused');
    });
  });
});
