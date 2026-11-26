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
 * Rotate the JWT key with `rotate-jwt`, not by regenerating everything: the old key keeps
 * verifying tokens for the grace window (docs/OPERATIONS.md, "Rotate keys"):
 *
 *   pbpaste | node scripts/gen-secrets.js rotate-jwt production   # the current JWT_SIGNING_KEYS
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateKey, rotateKeys } from './dev-keys.js';

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

/** Keys retired longer ago than this are dropped at the next rotation. */
const PRUNE_RETIRED_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The next JWT key set: the active key retired (public half only, still verifying during the
 * grace window), a new active key, and keys retired over a day ago removed.
 * @param {string} environment
 * @param {string} currentJson  The current JWT_SIGNING_KEYS value.
 * @param {string} activeKid  The current JWT_ACTIVE_KID.
 * @param {Date} [now]
 */
export function rotateJwt(environment, currentJson, activeKid, now = new Date()) {
  /** @type {any[]} */
  const keys = JSON.parse(currentJson);
  if (!Array.isArray(keys) || !keys.some((k) => k.kid === activeKid)) {
    throw new Error('the active kid is not in the current key set');
  }
  const kept = keys.filter(
    (k) => !k.retiredAt || now.getTime() - Date.parse(k.retiredAt) < PRUNE_RETIRED_AFTER_MS,
  );
  const rotated = rotateKeys(kept, activeKid, now);
  const fresh = rotated.keys.at(-1);
  if (!fresh) throw new Error('rotation produced no key');
  const kid = `${environment}-${String(fresh.kid).replace(/^dev-/, '')}`;
  return {
    JWT_SIGNING_KEYS: JSON.stringify([...rotated.keys.slice(0, -1), { ...fresh, kid }]),
    JWT_ACTIVE_KID: kid,
  };
}

/** @returns {Promise<string>} */
const readStdin = async () => {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
};

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'rotate-jwt') {
  const environment = process.argv[3];
  const input = await readStdin();
  try {
    // Accept either the bare JSON or the two lines `JWT_SIGNING_KEYS=…` and `JWT_ACTIVE_KID=…`.
    const lines = new Map(
      input.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    const json = lines.get('JWT_SIGNING_KEYS') ?? input;
    const active =
      lines.get('JWT_ACTIVE_KID') ??
      JSON.parse(json).find((/** @type {any} */ k) => !k.retiredAt && k.privateJwk)?.kid;
    if (environment !== 'staging' && environment !== 'production')
      throw new Error('usage: rotate-jwt staging|production');
    for (const [name, value] of Object.entries(rotateJwt(environment, json, active))) {
      process.stdout.write(`${name}=${value}\n\n`);
    }
    process.stdout.write(
      '# Replace both values in Render, then deploy. Do not save this output.\n',
    );
  } catch (error) {
    process.stderr.write(`rotate-jwt: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
