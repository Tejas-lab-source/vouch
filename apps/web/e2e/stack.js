// @ts-check
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestContainers, startTestStorage, TEST_STORAGE } from '@vouch/config/test/containers';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WEB = fileURLToPath(new URL('..', import.meta.url));
const ADMIN = fileURLToPath(new URL('../../admin', import.meta.url));
const MOBILE = fileURLToPath(new URL('../../mobile', import.meta.url));
const ADMIN_PASSWORD = 'e2e-admin-password-0123';
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
 *
 * With `E2E_CROSS_ORIGIN=1` (Phase 15) the apps are built the way they are deployed instead:
 * `VITE_API_BASE` is the API's own origin (another port: the same site, a different origin),
 * there is no proxy, and the API allows both apps' origins in CORS_ORIGINS. The refresh
 * cookie, CORS with credentials and the socket then work exactly as on Pages and Render.
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
  const [apiPort, metricsPort, webPort, adminPort] = [
    await freePort(),
    await freePort(),
    await freePort(),
    await freePort(),
  ];
  // A fixed port lets a prebuilt mobile export (which has its API origin built in) be reused.
  const mobilePort = Number(process.env.E2E_MOBILE_PORT ?? (await freePort()));
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
    // Encrypts admin TOTP secrets (32 bytes, base64); a fixed test-only value.
    ADMIN_TOTP_KEY: Buffer.alloc(32, 7).toString('base64'),
    // SeaweedFS stands in for R2 and the CDN; the browser uploads to it directly (CORS).
    R2_ENDPOINT: storage.endpoint,
    R2_ACCESS_KEY_ID: TEST_STORAGE.accessKeyId,
    R2_SECRET_ACCESS_KEY: TEST_STORAGE.secretAccessKey,
    R2_BUCKET: TEST_STORAGE.bucket,
    CDN_BASE_URL: storage.publicBaseUrl,
    CORS_ORIGINS: `http://127.0.0.1:${webPort},http://127.0.0.1:${adminPort},http://127.0.0.1:${mobilePort}`,
    MODERATION_PROVIDER: 'dev',
    // The 1,000-message chat test sends quickly from one user.
    RATE_LIMIT_MESSAGES_MINUTE: '5000',
    ...keyEnv,
  };
  /** @param {string[]} args @param {Record<string, string>} [extra] */
  const runApi = (args, extra = {}) => {
    const result = spawnSync(process.execPath, args, {
      cwd: `${ROOT}/apps/api`,
      env: { ...env, ...extra },
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  };
  runApi(['migrations/run.js', 'up']);
  runApi(['scripts/seed.js']);
  // One admin for the moderation tests (the password comes from the environment, never a flag).
  const created = runApi(
    [
      'scripts/admin-create.js',
      '--email',
      'e2e-admin@vouch.example',
      '--name',
      'E2E Admin',
      '--role',
      'admin',
    ],
    { ADMIN_CREATE_PASSWORD: ADMIN_PASSWORD },
  );
  const totpSecret = /secret=([A-Z2-7]+)/.exec(created)?.[1];
  if (!totpSecret) throw new Error('admin-create printed no TOTP secret');
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

  const crossOrigin = process.env.E2E_CROSS_ORIGIN === '1';
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  /** Build env: the API's own origin when cross-origin; otherwise same-origin via the proxy. */
  const buildEnv = { ...process.env, ...(crossOrigin ? { VITE_API_BASE: apiOrigin } : {}) };
  /** Preview env: no proxy target when cross-origin (requests go straight to the API). */
  const previewEnv = {
    ...process.env,
    VOUCH_API: crossOrigin ? 'http://127.0.0.1:9' : apiOrigin,
  };
  const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], {
    cwd: WEB,
    env: buildEnv,
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(`vite build failed: ${build.stderr}`);
  const web = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: WEB,
      env: previewEnv,
      stdio: 'ignore',
    },
  );
  await waitFor(`http://127.0.0.1:${webPort}/`, 30_000);

  // The staff console, built and served the same way (same-origin /v1 proxy).
  const adminBuild = spawnSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], {
    cwd: ADMIN,
    env: buildEnv,
    encoding: 'utf8',
  });
  if (adminBuild.status !== 0) throw new Error(`admin build failed: ${adminBuild.stderr}`);
  const admin = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(adminPort), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: ADMIN,
      env: previewEnv,
      stdio: 'ignore',
    },
  );
  await waitFor(`http://127.0.0.1:${adminPort}/`, 30_000);

  // The mobile app's Expo web export (design screenshots only, `E2E_MOBILE_WEB=1`).
  const mobile =
    process.env.E2E_MOBILE_WEB === '1' ? await serveMobileWeb(apiPort, mobilePort) : null;

  return {
    baseURL: `http://127.0.0.1:${webPort}`,
    mobileURL: mobile ? `http://127.0.0.1:${mobilePort}` : null,
    adminURL: `http://127.0.0.1:${adminPort}`,
    apiURL: apiOrigin,
    admin: { email: 'e2e-admin@vouch.example', password: ADMIN_PASSWORD, totpSecret },
    stop: async () => {
      web.kill('SIGTERM');
      admin.kill('SIGTERM');
      mobile?.close();
      api.kill('SIGTERM');
      await new Promise((resolve) => api.once('exit', resolve));
      await Promise.all([containers.stop(), storage.stop()]);
    },
  };
}

/**
 * Exports the mobile app for the web (react-native-web) and serves it as a single-page app,
 * with `/v1` and `/socket.io` proxied to the API: the export's API origin is the server's own
 * origin, so an export built earlier (`E2E_MOBILE_WEB_DIR`, with `E2E_MOBILE_PORT`) works with
 * a new stack. Used only for phone-sized design screenshots: the web product is apps/web.
 * @param {number} apiPort @param {number} port
 */
async function serveMobileWeb(apiPort, port) {
  const origin = `http://127.0.0.1:${port}`;
  // A prebuilt export (for example of an earlier commit, for "before" screenshots) is served as is.
  const prebuilt = process.env.E2E_MOBILE_WEB_DIR;
  const out = prebuilt ?? join(tmpdir(), 'vouch-mobile-web');
  const exported = prebuilt
    ? { status: 0, stderr: '' }
    : spawnSync(
        'pnpm',
        ['exec', 'expo', 'export', '--platform', 'web', '--clear', '--output-dir', out],
        { cwd: MOBILE, env: { ...process.env, VOUCH_API_URL: origin }, encoding: 'utf8' },
      );
  if (exported.status !== 0) throw new Error(`expo export failed: ${exported.stderr}`);
  const types = new Map([
    ['.html', 'text/html'],
    ['.js', 'text/javascript'],
    ['.css', 'text/css'],
    ['.json', 'application/json'],
    ['.png', 'image/png'],
    ['.ttf', 'font/ttf'],
    ['.svg', 'image/svg+xml'],
  ]);
  const server = createHttpServer(async (request, response) => {
    if (/^\/(v1|socket\.io)\//.test(request.url ?? '')) {
      const upstream = httpRequest(
        {
          host: '127.0.0.1',
          port: apiPort,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (reply) => {
          response.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(response);
        },
      );
      upstream.on('error', () => response.destroy());
      request.pipe(upstream);
      return;
    }
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname));
    const file = join(out, path);
    try {
      if (!file.startsWith(out) || !extname(file)) throw new Error('route');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the export
      const body = await readFile(file);
      response.writeHead(200, {
        'content-type': types.get(extname(file)) ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(200, { 'content-type': 'text/html' });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the export
      response.end(await readFile(join(out, 'index.html')));
    }
  }).listen(port, '127.0.0.1');
  // WebSocket upgrades (socket.io) go straight through to the API.
  server.on('upgrade', (request, socket, head) => {
    const upstream = connect(apiPort, '127.0.0.1', () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`];
      const raw = request.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) lines.push(`${raw.at(i)}: ${raw.at(i + 1)}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await waitFor(`${origin}/`, 10_000);
  return server;
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
