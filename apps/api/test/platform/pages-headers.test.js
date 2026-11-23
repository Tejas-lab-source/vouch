// @ts-check
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { renderLanding } from '../../../../scripts/landing-build.js';
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

  it('landing: no scripts at all', () => {
    const policy = csp(pagesHeaders({ app: 'landing' }));
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.has('script-src')).toBe(false);
  });

  it('landing page: every placeholder is filled with the deployed origins, or the build fails', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed file
    const html = await readFile(
      new URL('../../../../apps/landing/index.html', import.meta.url),
      'utf8',
    );
    const out = renderLanding(html, {
      SITE_URL: 'https://example.app/',
      WEB_URL: 'https://app.example.app',
      GRIEVANCE_EMAIL: 'grievance@example.app',
    });
    expect(out).not.toMatch(/\{\{/);
    expect(out).toContain('href="https://app.example.app/privacy"');
    expect(out).toContain('content="https://example.app/og.png"');
    expect(out).not.toMatch(/<script/i);
    expect(() => renderLanding(html, { SITE_URL: 'https://example.app' })).toThrow(/WEB_URL/);
  });
});
