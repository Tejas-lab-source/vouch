// @ts-check
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { seed } from '../../../scripts/seed.js';
import modules from '../../../src/modules/index.js';
import { createPlatform, startRole } from '../../../src/platform/boot.js';
import { loadConfig } from '../../../src/platform/config.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  eventually,
  liveSessionId,
  makeKeys,
  startInfra,
  testEnv,
} from '../../platform/helpers.js';

const MAIN = fileURLToPath(new URL('../../../src/main.js', import.meta.url));
const H = { 'x-app-version': '1.0.0', 'content-type': 'application/json' };
let metricsPort = 19_500 + Math.floor(Math.random() * 2000);

/**
 * A chat test stack: Postgres and Redis (Testcontainers), the 2,000-user seed, one `all`
 * runtime (REST and workers) and two `ws` gateways on random ports sharing one Redis.
 * @param {Record<string, string>} [env]
 */
export async function startChatStack(env = {}) {
  const infra = await startInfra();
  const keys = await makeKeys({ kid: 'active-1' });
  await seed(infra.admin);
  /** @param {'all' | 'ws'} role @param {boolean} listen */
  const start = async (role, listen) => {
    const config = loadConfig(
      testEnv({
        ROLE: role,
        PORT: '0',
        METRICS_PORT: String((metricsPort += 1)),
        DATABASE_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
        SHUTDOWN_DRAIN_MS: '2000',
        ...env,
      }),
    );
    const platform = await createPlatform({
      config,
      logger: createLogger({ level: /** @type {any} */ (process.env.P10_LOG ?? 'silent') }),
    });
    return startRole({ platform, modules, listen });
  };
  /** @type {any} */
  const app = await start('all', false);
  /** @type {any} */
  const gatewayA = await start('ws', true);
  /** @type {any} */
  const gatewayB = await start('ws', true);
  /** @param {any} runtime */
  const urlOf = (runtime) => `http://127.0.0.1:${runtime.http.server.address().port}`;
  const users = await infra.admin`SELECT u.id, u.public_id FROM identity.users u
    JOIN profiles.profiles p ON p.user_id = u.id WHERE p.status = 'active' ORDER BY u.id LIMIT 600`;
  let next = 0;

  /**
   * An access token on the user's live session (sensitive routes check it, Phase 14).
   * @param {any} user @param {{ expiresIn?: string }} [opts]
   */
  const token = async (user, opts = {}) =>
    keys.sign({ sub: user.id, sid: await liveSessionId(infra.admin, user.id) }, opts);

  /**
   * A socket client for `user` on a gateway; resolves once connected.
   * @param {any} runtime @param {any} user @param {{ token?: string }} [opts]
   */
  async function socketFor(runtime, user, opts = {}) {
    const socket = connect(urlOf(runtime), {
      transports: ['websocket'],
      auth: { token: opts.token ?? (await token(user)) },
      reconnection: false,
      forceNew: true,
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(undefined));
      socket.once('connect_error', reject);
    });
    return socket;
  }

  /** Emit with ack, as a promise. @param {any} socket @param {string} event @param {unknown} payload */
  const ask = (socket, event, payload) =>
    new Promise((resolve) => socket.emit(event, payload, resolve));

  /**
   * Two fresh seeded users matched through the real matching flow; resolves once the
   * conversation exists.
   */
  async function matchedPair() {
    const [a, b] = [users[next++], users[next++]];
    const redis = app.platform.redis.command;
    await redis.sadd(`discovery:served:${a.id}`, b.id);
    await redis.sadd(`discovery:served:${b.id}`, a.id);
    const like = async (/** @type {any} */ from, /** @type {any} */ to) =>
      (
        await app.http.inject({
          method: 'POST',
          url: '/v1/swipes',
          headers: { ...H, authorization: `Bearer ${await token(from)}` },
          payload: { swipeId: randomUUID(), targetId: to.public_id, direction: 'like' },
        })
      ).json();
    await like(a, b);
    const second = await like(b, a);
    if (!second.matched) throw new Error(`matchedPair: ${JSON.stringify(second)}`);
    const { matchId } = second;
    await eventually(
      async () =>
        (await infra.admin`SELECT 1 FROM chat.conversations WHERE id = ${matchId}`).length === 1,
      60_000,
    );
    return { a, b, conversationId: /** @type {string} */ (matchId) };
  }

  /** @param {any} user */
  /** @param {any} user @param {string} url @param {string} [method] @param {unknown} [payload] */
  const rest = async (user, url, method = 'GET', payload = undefined) => {
    const response = await app.http.inject({
      method,
      url,
      headers: {
        'x-app-version': '1.0.0',
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...(method === 'DELETE' ? { 'idempotency-key': randomUUID() } : {}),
        authorization: `Bearer ${await token(user)}`,
      },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() };
  };

  /** @type {import('node:child_process').ChildProcess[]} */
  const children = [];

  /**
   * Starts `ROLE=ws` as a separate process sharing this stack's Postgres and Redis; resolves
   * once it serves /ready.
   * @param {Record<string, string>} [extra]
   */
  async function spawnGateway(extra = {}) {
    const [port, metrics] = [await freePort(), await freePort()];
    const child = spawn(process.execPath, [MAIN], {
      env: {
        ...process.env,
        ...testEnv({
          ROLE: 'ws',
          PORT: String(port),
          METRICS_PORT: String(metrics),
          DATABASE_URL: infra.appUrl,
          REDIS_URL: infra.redisUrl,
          JWT_SIGNING_KEYS: keys.json,
          JWT_ACTIVE_KID: keys.kid,
          ...env,
          ...extra,
        }),
      },
      stdio: 'ignore',
    });
    children.push(child);
    const url = `http://127.0.0.1:${port}`;
    await eventually(
      () =>
        fetch(`${url}/ready`).then(
          (r) => r.ok,
          () => false,
        ),
      30_000,
    );
    return { url, child, metricsUrl: `http://127.0.0.1:${metrics}/metrics` };
  }

  /** Connects to a gateway URL; resolves once connected. @param {string} url @param {string} bearer */
  const socketAt = (url, bearer) =>
    new Promise((resolve, reject) => {
      const socket = connect(url, {
        transports: ['websocket'],
        auth: { token: bearer },
        reconnection: false,
        forceNew: true,
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });

  return {
    infra,
    keys,
    app,
    gatewayA,
    gatewayB,
    users,
    token,
    socketFor,
    ask,
    matchedPair,
    rest,
    fresh: () => users[next++],
    spawnGateway,
    socketAt,
    stop: async () => {
      for (const child of children) child.kill('SIGKILL');
      for (const runtime of [gatewayA, gatewayB, app]) await runtime?.stop(10_000).catch(() => {});
      await infra.stop();
    },
  };
}

/** A free local port. @returns {Promise<number>} */
const freePort = () =>
  new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });

/**
 * Collects a socket's events of one name.
 * @param {any} socket @param {string} event
 */
export function collect(socket, event) {
  /** @type {any[]} */
  const seen = [];
  socket.on(event, (/** @type {any} */ payload) => seen.push(payload));
  return seen;
}
