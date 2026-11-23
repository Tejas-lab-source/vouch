// @ts-check
import { EnvSchema } from '@vouch/contracts';
import { describe, expect, it } from 'vitest';
import { LATEST_PRIVACY_NOTICE, PRIVACY_NOTICES, privacyNotice } from '../src/privacy-notice.js';

describe('privacy notice (Phase 14)', () => {
  it("the server's default notice version is one the clients ship", () => {
    const version = EnvSchema.shape.PRIVACY_NOTICE_VERSION.parse(undefined);
    expect(PRIVACY_NOTICES.has(version)).toBe(true);
    expect(version).toBe(LATEST_PRIVACY_NOTICE);
  });

  it('covers what the DPDP notice must say, and is marked draft until legal review', () => {
    const notice = /** @type {import('../src/privacy-notice.js').PrivacyNotice} */ (
      privacyNotice(LATEST_PRIVACY_NOTICE)
    );
    const headings = notice.sections.map((s) => s.heading);
    for (const required of [
      'What we collect',
      'Why we use it',
      'Your consent',
      'How long we keep it',
      'Your rights',
    ]) {
      expect(headings).toContain(required);
    }
    const text = JSON.stringify(notice);
    expect(text).toContain('Data Protection Board');
    expect(text).toMatch(/grievance/i);
    expect(notice.status).toBe('draft');
  });

  it('an unknown version has no text (the app must be updated)', () => {
    expect(privacyNotice('1999-01')).toBeNull();
    expect(privacyNotice(undefined)).toBeNull();
  });
});
