// @ts-check
/**
 * Generates the secrets a deployed environment needs (Phase 15). Run it on your own computer,
 * once per environment (staging, then production: never share values between them). Paste
 * each printed value into Render → the service → Environment, then close the terminal. The
 * values are printed only to your screen; nothing is written to disk or sent anywhere.
 *
 *   node scripts/gen-secrets.js staging
 *   node scripts/gen-secrets.js production
 *
 * Keep EMAIL_HMAC_SECRET and ADMIN_TOTP_KEY for the life of the environment:
 * - EMAIL_HMAC_SECRET links each account to its college email; changing it orphans every
 *   account (nobody can sign in to their old account again).
 * - ADMIN_TOTP_KEY encrypts staff TOTP secrets; changing it means every staff account must be
 *   enrolled again.
 * Rotate the JWT key with `pnpm dev:keys --rotate`'s logic (docs/OPERATIONS.md), not by
 * regenerating here, so tokens signed with the old key stay valid during the grace window.
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateKey } from './dev-keys.js';

/** @param {string} environment */
export function generateSecrets(environment) {
  const key = generateKey(new Date());
  const kid = `${environment}-${key.kid.replace(/^dev-/, '')}`;
  return {
    JWT_SIGNING_KEYS: JSON.stringify([{ ...key, kid }]),
    JWT_ACTIVE_KID: kid,
    EMAIL_HMAC_SECRET: randomBytes(32).toString('base64url'),
    COOKIE_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_TOTP_KEY: randomBytes(32).toString('base64'),
    METRICS_SCRAPE_TOKEN: randomBytes(32).toString('base64url'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const environment = process.argv[2];
  if (environment !== 'staging' && environment !== 'production') {
    process.stderr.write('usage: node scripts/gen-secrets.js staging|production\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `# ${environment}: paste each line's value into Render → the web service → Environment\n` +
        '# (and METRICS_SCRAPE_TOKEN also into Grafana Cloud → Metrics Endpoint). Do not save this.\n\n',
    );
    for (const [name, value] of Object.entries(generateSecrets(environment))) {
      process.stdout.write(`${name}=${value}\n\n`);
    }
  }
}
