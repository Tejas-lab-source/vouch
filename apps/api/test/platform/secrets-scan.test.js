// @ts-check
import { describe, expect, it } from 'vitest';
import { scan } from '../../../../scripts/secrets-scan.js';

describe('secrets scan (Phase 14)', () => {
  it('finds each credential format and never prints the value', () => {
    const fake = [
      ['private key', '-----BEGIN PRIVATE KEY-----'],
      ['AWS access key id', `key = "AKIA${'Q'.repeat(16)}"`],
      ['GitHub token', `ghp_${'a1'.repeat(18)}`],
      ['Stripe live key', `sk_live_${'x'.repeat(24)}`],
      ['Resend API key', `re_${'a'.repeat(8)}_${'b'.repeat(24)}`],
    ];
    for (const [rule, line] of fake) {
      const findings = scan('file.js', `ok\n${line}\n`);
      expect(findings).toEqual([`file.js:2 ${rule}`]);
      expect(findings.join()).not.toContain(line.slice(-10));
    }
  });

  it('ignores placeholders, local URLs and test values', () => {
    const clean = [
      'DATABASE_URL=postgres://vouch:vouch@localhost:5432/vouch',
      "COOKIE_SECRET: 'c'.repeat(32)",
      'RESEND_API_KEY=re_placeholder',
      'EXPO_ACCESS_TOKEN=',
    ].join('\n');
    expect(scan('.env.example', clean)).toEqual([]);
  });
});
