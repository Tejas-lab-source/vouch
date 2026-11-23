// @ts-check
/**
 * Writes Cloudflare Pages' `_headers` file into a built app (Phase 15): a strict Content
 * Security Policy built from the deployed origins, plus HSTS and the usual hardening headers,
 * and long caching for hashed assets. Run by the deploy workflow after `vite build`:
 *
 *   node scripts/pages-headers.js apps/web/dist --app web --api https://api.example.app \
 *     --cdn https://cdn.example.app --upload https://<account>.r2.cloudflarestorage.com \
 *     --sentry https://o0.ingest.sentry.io
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const TURNSTILE = 'https://challenges.cloudflare.com';

/** @param {string | undefined} value @param {string} name */
function origin(value, name) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${name} must be https: ${value}`);
  return url.origin;
}

/**
 * @param {{ app: 'web' | 'admin', api: string, cdn?: string, upload?: string, sentry?: string }} options
 * @returns {string} the `_headers` file
 */
export function pagesHeaders({ app, api, cdn, upload, sentry }) {
  const apiOrigin = /** @type {string} */ (origin(api, '--api'));
  const socket = apiOrigin.replace(/^https:/, 'wss:');
  const cdnOrigin = origin(cdn, '--cdn');
  const uploadOrigin = origin(upload, '--upload');
  const sentryOrigin = origin(sentry, '--sentry');
  const web = app === 'web';
  const connect = ["'self'", apiOrigin, ...(web ? [socket] : [])];
  if (uploadOrigin && web) connect.push(uploadOrigin);
  if (sentryOrigin) connect.push(sentryOrigin);
  const images = ["'self'", 'data:', 'blob:', ...(cdnOrigin ? [cdnOrigin] : [])];
  const csp = [
    "default-src 'self'",
    `script-src 'self'${web ? ` ${TURNSTILE}` : ''}`,
    `frame-src ${web ? TURNSTILE : "'none'"}`,
    `connect-src ${connect.join(' ')}`,
    `img-src ${images.join(' ')}`,
    // React style attributes (layout values) need inline styles; scripts never run inline.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  const lines = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    `  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`,
    '  Cross-Origin-Opener-Policy: same-origin',
    ...(web ? [] : ['  X-Robots-Tag: noindex, nofollow']),
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: 'string' },
      api: { type: 'string' },
      cdn: { type: 'string' },
      upload: { type: 'string' },
      sentry: { type: 'string' },
    },
  });
  const [dist] = positionals;
  if (!dist || (values.app !== 'web' && values.app !== 'admin') || !values.api) {
    process.stderr.write(
      'usage: node scripts/pages-headers.js <dist> --app web|admin --api <https origin> ' +
        '[--cdn <origin>] [--upload <origin>] [--sentry <origin>]\n',
    );
    process.exitCode = 1;
  } else {
    const file = join(dist, '_headers');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the build folder given
    await writeFile(file, pagesHeaders({ ...values, app: values.app, api: values.api }));
    process.stdout.write(`wrote ${file}\n`);
  }
}
