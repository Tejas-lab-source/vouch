// @ts-check
import { describe, expect, it } from 'vitest';
import { pagesHeaders } from '../../../../scripts/pages-headers.js';

/** @param {string} file */
const csp = (file) =>
  new Map(
    (file.split('\n').find((l) => l.includes('Content-Security-Policy')) ?? '')
      .replace(/^\s*Content-Security-Policy:\s*/, '')
      .split('; ')
      .map((d) => [d.split(' ')[0], d.split(' ').slice(1)]),
  );

describe('Cloudflare Pages headers (Phase 15)', () => {
  it('web: the API (HTTPS and WSS), uploads, CDN images, Turnstile and Sentry; nothing else', () => {
    const file = pagesHeaders({
      app: 'web',
      api: 'https://api.example.app/ignored/path',
      cdn: 'https://cdn.example.app',
      upload: 'https://acc.r2.cloudflarestorage.com',
      sentry: 'https://o1.ingest.sentry.io',
    });
    const policy = csp(file);
    expect(policy.get('connect-src')).toEqual([
      "'self'",
      'https://api.example.app',
      'wss://api.example.app',
      'https://acc.r2.cloudflarestorage.com',
      'https://o1.ingest.sentry.io',
    ]);
    expect(policy.get('script-src')).toEqual(["'self'", 'https://challenges.cloudflare.com']);
    expect(policy.get('img-src')).toContain('https://cdn.example.app');
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(file).toContain('Strict-Transport-Security: max-age=31536000');
    expect(file).toMatch(/\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
    expect(file).not.toContain('X-Robots-Tag');
  });

  it('admin: no Turnstile, no socket, no uploads, and not indexed', () => {
    const file = pagesHeaders({
      app: 'admin',
      api: 'https://api.example.app',
      upload: 'https://acc.r2.cloudflarestorage.com',
    });
    const policy = csp(file);
    expect(policy.get('connect-src')).toEqual(["'self'", 'https://api.example.app']);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('frame-src')).toEqual(["'none'"]);
    expect(file).toContain('X-Robots-Tag: noindex, nofollow');
  });

  it('refuses a non-HTTPS origin', () => {
    expect(() => pagesHeaders({ app: 'web', api: 'http://api.example.app' })).toThrow(/https/);
  });
});
