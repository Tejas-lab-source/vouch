// @ts-check
import { describe, expect, it } from 'vitest';
import { createTranslator, en, t } from '../src/index.js';

describe('i18n', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('auth.code.sent', { email: 'a@b.edu' })).toBe(
      'We sent a code to a@b.edu. It expires in 10 minutes.',
    );
    expect(t('ui.otp.digit', { n: 1 })).toBe('Digit 1 of {total}');
  });

  it('throws on a missing key, so a missing string fails tests', () => {
    expect(() => t(/** @type {any} */ ('nope.missing'))).toThrow(/missing string/);
  });

  it('every string is non-empty and keys are dotted', () => {
    for (const [key, value] of Object.entries(en)) {
      const parts = key.split('.');
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.every((part) => /^[a-zA-Z]+$/.test(part))).toBe(true);
      expect(key.charAt(0)).toMatch(/[a-z]/);
      expect(value.trim().length).toBeGreaterThan(0);
    }
    expect(createTranslator('en')('app.name')).toBe('Vouch');
  });
});
