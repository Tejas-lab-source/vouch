// @ts-check
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * Local Ed25519 signing keys for access tokens (development only). Uses only Node's built-in
 * crypto, so it also runs in CI before dependencies are installed.
 *
 *   pnpm dev:keys            print JWT_SIGNING_KEYS and JWT_ACTIVE_KID
 *   pnpm dev:keys --write    write them into .env (git-ignored)
 *   pnpm dev:keys --rotate   add a new active key; retire the old one (kept for verification)
 */

/**
 * @typedef {object} DevKey
 * @property {string} kid
 * @property {Record<string, unknown>} publicJwk
 * @property {Record<string, unknown>} [privateJwk]
 * @property {string} [retiredAt]
 */

/**
 * Generates one Ed25519 key pair as JWKs.
 * @param {Date} now
 * @returns {DevKey}
 */
export function generateKey(now) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = `dev-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex')}`;
  return {
    kid,
    publicJwk: /** @type {Record<string, unknown>} */ (publicKey.export({ format: 'jwk' })),
    privateJwk: /** @type {Record<string, unknown>} */ (privateKey.export({ format: 'jwk' })),
  };
}

/**
 * Adds a new active key and retires the current one: it keeps verifying for the grace window
 * after `retiredAt`, and its private half is dropped.
 * @param {DevKey[]} keys
 * @param {string} activeKid
 * @param {Date} now
 * @returns {{ keys: DevKey[], activeKid: string }}
 */
export function rotateKeys(keys, activeKid, now) {
  const next = generateKey(now);
  const retired = keys.map((key) =>
    key.kid === activeKid
      ? { kid: key.kid, publicJwk: key.publicJwk, retiredAt: now.toISOString() }
      : key,
  );
  return { keys: [...retired, next], activeKid: next.kid };
}

/**
 * Sets variables in .env text, replacing existing lines or appending new ones.
 * @param {string} text
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function updateEnvText(text, vars) {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  for (const [name, value] of Object.entries(vars)) {
    const line = `${name}=${value}`;
    const index = lines.findIndex((existing) => existing.startsWith(`${name}=`));
    if (index === -1) lines.push(line);
    else lines.splice(index, 1, line);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Reads a variable from .env text.
 * @param {string} text
 * @param {string} name
 */
export function readEnvVar(text, name) {
  const line = text.split('\n').find((existing) => existing.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('dev:keys is for local development only (NODE_ENV=production)');
  }
  const { values } = parseArgs({
    options: {
      write: { type: 'boolean', default: false },
      rotate: { type: 'boolean', default: false },
      env: { type: 'string', default: '.env' },
    },
  });
  const now = new Date();
  const envPath = values.env ?? '.env';

  if (!values.write && !values.rotate) {
    const key = generateKey(now);
    process.stdout.write(`JWT_SIGNING_KEYS=${JSON.stringify([key])}\nJWT_ACTIVE_KID=${key.kid}\n`);
    return;
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- local .env path chosen by the developer
  const text = await readFile(envPath, 'utf8').catch(() => {
    throw new Error(`${envPath} not found: copy .env.example to .env first`);
  });
  let keys = [generateKey(now)];
  let activeKid = keys[0]?.kid ?? '';
  if (values.rotate) {
    const current = JSON.parse(readEnvVar(text, 'JWT_SIGNING_KEYS') ?? '[]');
    ({ keys, activeKid } = rotateKeys(current, readEnvVar(text, 'JWT_ACTIVE_KID') ?? '', now));
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- local .env path chosen by the developer
  await writeFile(
    envPath,
    updateEnvText(text, { JWT_SIGNING_KEYS: JSON.stringify(keys), JWT_ACTIVE_KID: activeKid }),
  );
  process.stdout.write(
    `${values.rotate ? 'Rotated' : 'Wrote'} signing keys in ${envPath}; active kid ${activeKid}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
