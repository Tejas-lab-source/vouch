// @ts-check
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { startTestContainers, startTestStorage, TEST_STORAGE } from '@vouch/config/test/containers';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WEB = fileURLToPath(new URL('..', import.meta.url));
export const API_LOG = fileURLToPath(new URL('../test-results/api.log', import.meta.url));

/** @returns {Promise<number>} */
const freePort = () =>
  new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });

/** @param {string} url @param {number} ms */
async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not come up`);
}

/**
 * The real backend for the web end-to-end tests: Postgres and Redis (Testcontainers), the
 * real migrations and seed, the API (`ROLE=all`, development email and captcha), and the
 * built web app served by `vite preview`, which proxies `/v1` and `/socket.io` to the API.
 */
export async function startStack() {
  const [containers, storage] = await Promise.all([startTestContainers(), startTestStorage()]);
  const keys = spawnSync(process.execPath, ['scripts/dev-keys.js'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const keyEnv = Object.fromEntries(
    keys.stdout
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const [apiPort, metricsPort, webPort] = [await freePort(), await freePort(), await freePort()];
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    ROLE: 'all',
    PORT: String(apiPort),
    METRICS_PORT: String(metricsPort),
    HOST: '127.0.0.1',
    DATABASE_URL: containers.postgresUrl,
    REDIS_URL: containers.redisUrl,
    EMAIL_HMAC_SECRET: 'e2e-email-hmac-secret-0123456789abcdef',
    COOKIE_SECRET: 'e2e-cookie-secret-0123456789abcdef0123',
    // SeaweedFS stands in for R2 and the CDN; the browser uploads to it directly (CORS).
    R2_ENDPOINT: storage.endpoint,
    R2_ACCESS_KEY_ID: TEST_STORAGE.accessKeyId,
    R2_SECRET_ACCESS_KEY: TEST_STORAGE.secretAccessKey,
    R2_BUCKET: TEST_STORAGE.bucket,
    CDN_BASE_URL: storage.publicBaseUrl,
    CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
    MODERATION_PROVIDER: 'dev',
    ...keyEnv,
  };
  /** @param {string[]} args */
  const runApi = (args) => {
    const result = spawnSync(process.execPath, args, {
      cwd: `${ROOT}/apps/api`,
      env,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr}`);
  };
  runApi(['migrations/run.js', 'up']);
  runApi(['scripts/seed.js']);
  // The bucket and its upload CORS rule; SeaweedFS needs a moment before it accepts buckets.
  for (let attempt = 0; ; attempt += 1) {
    try {
      runApi(['scripts/storage-init.js']);
      break;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this run's API log
  const log = createWriteStream(API_LOG);
  const api = spawn(process.execPath, ['src/main.js'], {
    cwd: `${ROOT}/apps/api`,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.pipe(log);
  api.stderr.pipe(log);
  await waitFor(`http://127.0.0.1:${apiPort}/ready`, 60_000);

  const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], {
    cwd: WEB,
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(`vite build failed: ${build.stderr}`);
  const web = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: WEB,
      env: { ...process.env, VOUCH_API: `http://127.0.0.1:${apiPort}` },
      stdio: 'ignore',
    },
  );
  await waitFor(`http://127.0.0.1:${webPort}/`, 30_000);

  return {
    baseURL: `http://127.0.0.1:${webPort}`,
    stop: async () => {
      web.kill('SIGTERM');
      api.kill('SIGTERM');
      await new Promise((resolve) => api.once('exit', resolve));
      await Promise.all([containers.stop(), storage.stop()]);
    },
  };
}

/** Every development sign-in code the API logged, oldest first (the log has no emails). */
async function codes() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the API log of this run
  const text = await readFile(API_LOG, 'utf8');
  return [...text.matchAll(/"devOtp":"(\d{6})"/g)].map((m) => /** @type {string} */ (m[1]));
}

/** The most recent development sign-in code the API logged. */
export async function lastCode() {
  return (await codes()).at(-1) ?? null;
}

/** How many codes have been logged (call before requesting one, then `codeAfter(n)`). */
export async function codeCount() {
  return (await codes()).length;
}

/** The first code logged after `count` codes, or null while it has not arrived. @param {number} count */
export async function codeAfter(count) {
  return (await codes()).at(count) ?? null;
}
