// @ts-check
import { execFileSync } from 'node:child_process';
import { startTestContainers } from '@vouch/config/test/containers';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import postgres from 'postgres';
import { migrate } from '../../migrations/run.js';
import { DB_MODULES } from '../../src/platform/db.js';

export const HOOK_TIMEOUT_MS = 180_000;

/** Login used by the kernel in tests: not a superuser, member of every module role. */
const APP_LOGIN = { user: 'vouch_app', password: 'vouch_app_test' };

/**
 * Creates the test-only `vouch_example` role with the same event-table grants as module roles.
 * @param {import('postgres').Sql} sql
 */
async function createExampleRole(sql) {
  await sql.unsafe(`
    CREATE ROLE vouch_example NOLOGIN;
    GRANT vouch_views TO vouch_example;
    GRANT USAGE ON SCHEMA platform TO vouch_example;
    GRANT INSERT, SELECT (id) ON platform.outbox TO vouch_example;
    GRANT USAGE ON SEQUENCE platform.outbox_id_seq TO vouch_example;
    GRANT SELECT, INSERT ON platform.inbox TO vouch_example;
    GRANT SELECT ON platform.feature_flags TO vouch_example;`);
}

/**
 * @typedef {object} Infra
 * @property {string} adminUrl  Superuser (migrations, assertions).
 * @property {string} appUrl  The kernel's login (`vouch_app`).
 * @property {string} redisUrl
 * @property {import('postgres').Sql} admin  Superuser client for assertions.
 * @property {(action: 'pause' | 'unpause') => void} redisControl  Pauses or resumes Redis.
 * @property {() => Promise<void>} stop
 */

/**
 * Starts Postgres 17 and Redis 7, applies migrations and creates the kernel login.
 * @returns {Promise<Infra>}
 */
export async function startInfra() {
  const containers = await startTestContainers();
  await migrate({ databaseUrl: containers.postgresUrl, direction: 'up' });
  const admin = postgres(containers.postgresUrl, { max: 2, onnotice: () => {} });
  await createExampleRole(admin);
  const roles = [...DB_MODULES, 'example'].map((m) => `vouch_${m}`).join(', ');
  await admin.unsafe(`CREATE ROLE ${APP_LOGIN.user} LOGIN PASSWORD '${APP_LOGIN.password}';
    GRANT ${roles} TO ${APP_LOGIN.user};`);
  const url = new URL(containers.postgresUrl);
  url.username = APP_LOGIN.user;
  url.password = APP_LOGIN.password;
  return {
    adminUrl: containers.postgresUrl,
    appUrl: url.toString(),
    redisUrl: containers.redisUrl,
    admin,
    redisControl: (action) => {
      execFileSync('docker', [action, containers.redisContainerId], {
        stdio: 'ignore',
        timeout: 30_000,
      });
    },
    stop: async () => {
      await admin.end({ timeout: 5 });
      await containers.stop();
    },
  };
}

/**
 * @typedef {object} TestKeys
 * @property {string} json  JWT_SIGNING_KEYS value.
 * @property {string} kid
 * @property {Awaited<ReturnType<typeof generateKeyPair>>['privateKey']} privateKey
 * @property {(claims?: Record<string, unknown>, opts?: { audience?: string, expiresIn?: string, kid?: string, at?: Date }) => Promise<string>} sign
 */

/**
 * Generates an Ed25519 key pair and a signer for test tokens.
 * @param {{ kid?: string, retiredAt?: string }} [options]
 * @returns {Promise<TestKeys>}
 */
export async function makeKeys({ kid = 'test-1', retiredAt } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  return {
    kid,
    privateKey,
    json: JSON.stringify([{ kid, publicJwk, ...(retiredAt ? { retiredAt } : { privateJwk }) }]),
    sign: (claims = {}, opts = {}) =>
      new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'EdDSA', kid: opts.kid ?? kid })
        .setIssuer('vouch')
        .setAudience(opts.audience ?? 'vouch:user')
        .setSubject(String(claims.sub ?? '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f'))
        .setIssuedAt(opts.at ?? new Date())
        .setExpirationTime(
          opts.at ? new Date(opts.at.getTime() + 15 * 60 * 1000) : (opts.expiresIn ?? '15m'),
        )
        .sign(privateKey),
  };
}

/**
 * A complete, valid environment for loadConfig.
 * @param {Record<string, string>} [overrides]
 * @returns {Record<string, string>}
 */
export function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://vouch_app:x@127.0.0.1:5432/vouch',
    REDIS_URL: 'redis://127.0.0.1:6379',
    EMAIL_HMAC_SECRET: 'h'.repeat(32),
    COOKIE_SECRET: 'c'.repeat(32),
    JWT_SIGNING_KEYS: JSON.stringify([
      { kid: 'test-1', publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'aGVsbG8' } },
    ]),
    JWT_ACTIVE_KID: 'test-1',
    R2_ACCESS_KEY_ID: 'minio',
    R2_SECRET_ACCESS_KEY: 'minio-secret',
    R2_BUCKET: 'vouch',
    CDN_BASE_URL: 'http://localhost:9000/vouch',
    ...overrides,
  };
}

/**
 * Polls until `fn` returns a truthy value or the timeout passes.
 * @template T
 * @param {() => Promise<T> | T} fn
 * @param {number} [timeoutMs]
 * @returns {Promise<NonNullable<T>>}
 */
export async function eventually(fn, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return /** @type {NonNullable<T>} */ (last);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met within ${timeoutMs} ms (last: ${JSON.stringify(last)})`);
}
