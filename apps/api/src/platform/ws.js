// @ts-check
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import { CLIENT_EVENTS, SERVER_EVENTS } from '@vouch/contracts';
import { Server } from 'socket.io';
import { AUDIENCE } from './auth.js';
import { createProxyTrust } from './client-ip.js';
import { runWithContext } from './context.js';
import { AppError, normaliseError as normalise } from './errors.js';

/** @param {unknown} error @returns {AppError} */
const normaliseError = (error) => /** @type {AppError} */ (normalise(error));

/** Socket.IO pings every 25 s (ARCHITECTURE.md 9.3); a client that misses 20 s more is gone. */
const PING_INTERVAL_MS = 25_000;
const PING_TIMEOUT_MS = 20_000;
/** Disconnects on shutdown are spread over at most this long, inside the drain window. */
const DRAIN_SPREAD_MS = 20_000;

/** @param {string} userId */
export const userRoom = (userId) => `user:${userId}`;

const clientEvents = new Map(Object.entries(CLIENT_EVENTS));
const serverEvents = new Map(Object.entries(SERVER_EVENTS));

/**
 * Sends server events to users' rooms through Redis, from any role (ADR 0017). The payload is
 * validated against the socket contract first, so a malformed event never reaches a client.
 * Live delivery is best-effort (clients replay with `sync`), so a failed publish is logged,
 * never thrown at the caller and never left as an unhandled rejection.
 * @param {{ redis: import('ioredis').Redis, logger?: import('pino').Logger }} deps
 */
export function createSocketEmitter({ redis, logger }) {
  const client = {
    /** @param {string} channel @param {Buffer | string} message */
    publish: (channel, message) =>
      redis.publish(channel, message).catch((err) => {
        logger?.warn({ err }, 'socket emit failed');
        return 0;
      }),
  };
  const emitter = new Emitter(/** @type {any} */ (client));
  return {
    /**
     * @param {string} userId
     * @param {string} event  A key of `SERVER_EVENTS`.
     * @param {unknown} payload
     */
    emitToUser(userId, event, payload) {
      const definition = serverEvents.get(event);
      if (!definition) throw new Error(`unknown server event: ${event}`);
      emitter.to(userRoom(userId)).emit(event, definition.payload.parse(payload));
    },
  };
}

/** @typedef {ReturnType<typeof createSocketEmitter>} SocketEmitter */

/**
 * @typedef {object} SocketContext
 * @property {{ userId: string, audience: 'vouch:user', mfa: false, sessionId: string | undefined }} actor
 * @property {string} socketId
 * @property {string} ip
 */

/**
 * What a module registers under the manifest key `socket.handlers`.
 * @typedef {object} SocketHandlers
 * @property {Record<string, (payload: any, ctx: SocketContext) => Promise<unknown>>} [events]
 *   Client event name (a key of `CLIENT_EVENTS`) → handler; its result is the ack's success body.
 * @property {(ctx: SocketContext) => Promise<void> | void} [onConnect]
 * @property {(ctx: SocketContext) => Promise<void> | void} [onHeartbeat]  On every pong.
 * @property {(ctx: SocketContext, remaining: number) => Promise<void> | void} [onDisconnect]
 *   `remaining`: the user's sockets still connected to this process.
 */

/**
 * The client's IP for a socket handshake, under the same trust rule as HTTP (ADR 0015).
 * @param {import('node:http').IncomingMessage} request
 * @param {ReturnType<typeof createProxyTrust>} trust
 */
function handshakeIp(request, trust) {
  const socket = request.socket.remoteAddress ?? '';
  if (!trust.isTrusted(socket)) return socket;
  const cf = request.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && isIP(cf.trim())) return cf.trim();
  const hops = String(request.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops.at(i) ?? '';
    if (!trust.isTrusted(hop)) return hop;
  }
  return socket;
}

/** @param {unknown} error @param {string} requestId */
function ackError(error, requestId) {
  const appError = normaliseError(error);
  return {
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId,
    },
  };
}

/**
 * The WebSocket gateway (ADR 0017): Socket.IO over WebSocket only, scaled across processes with
 * the Redis adapter. It authenticates the handshake with the access token, joins `user:{id}`,
 * validates every event against the socket contracts, acks with `{ ok, ... }`, keeps the
 * session alive through `auth.refresh`, and disconnects a socket whose token expired once the
 * grace period has passed. It holds no state that cannot be rebuilt.
 * @param {{
 *   server: import('node:http').Server,
 *   config: import('./config.js').Config,
 *   logger: import('pino').Logger,
 *   verifier: import('./auth.js').TokenVerifier,
 *   redis: import('./redis.js').RedisClients,
 *   clock: { now: () => Date },
 *   modules: readonly { module: string, handlers: SocketHandlers }[],
 * }} options
 */
export function createSocketGateway({ server, config, logger, verifier, redis, clock, modules }) {
  const trust = createProxyTrust(config.TRUSTED_PROXIES);
  const graceMs = config.SOCKET_REFRESH_GRACE_SECONDS * 1000;
  const io = new Server(server, {
    transports: ['websocket'],
    pingInterval: PING_INTERVAL_MS,
    pingTimeout: PING_TIMEOUT_MS,
    serveClient: false,
    cors: { origin: config.CORS_ORIGINS, credentials: true },
    adapter: createAdapter(redis.publisher, redis.subscriber),
  });
  let draining = false;

  /** Every module's handlers for one client event. */
  /** @type {Map<string, { module: string, handle: (payload: any, ctx: SocketContext) => Promise<unknown> }>} */
  const handlers = new Map();
  for (const { module, handlers: set } of modules) {
    for (const [event, handle] of Object.entries(set.events ?? {})) {
      if (!clientEvents.has(event))
        throw new Error(`${module} handles unknown socket event ${event}`);
      if (handlers.has(event)) throw new Error(`socket event ${event} has two handlers`);
      handlers.set(event, { module, handle });
    }
  }
  /** @param {'onConnect' | 'onHeartbeat'} hook @param {SocketContext} ctx */
  const each = async (hook, ctx) => {
    for (const { module, handlers: set } of modules) {
      try {
        const fn = hook === 'onConnect' ? set.onConnect : set.onHeartbeat;
        await fn?.(ctx);
      } catch (err) {
        logger.warn({ err, module, hook }, 'socket hook failed');
      }
    }
  };

  io.use(async (socket, next) => {
    if (draining)
      return next(
        Object.assign(new Error('TEMPORARILY_UNAVAILABLE'), {
          data: { code: 'TEMPORARILY_UNAVAILABLE' },
        }),
      );
    const token = socket.handshake.auth?.token;
    try {
      if (typeof token !== 'string' || token.length === 0) throw new AppError('UNAUTHENTICATED');
      const principal = await verifier.verify(token, AUDIENCE.USER);
      socket.data.user = principal;
      socket.data.ip = handshakeIp(socket.request, trust);
      return next();
    } catch (error) {
      const code = normaliseError(error).code;
      return next(Object.assign(new Error(code), { data: { code } }));
    }
  });

  io.on('connection', (socket) => {
    /** @type {import('./auth.js').Principal} */
    const user = socket.data.user;
    /** @type {SocketContext} */
    const ctx = {
      actor: { userId: user.userId, audience: 'vouch:user', mfa: false, sessionId: user.sessionId },
      socketId: socket.id,
      ip: socket.data.ip,
    };
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let expiryTimer;
    /** @param {Date | undefined} expiresAt */
    const scheduleExpiry = (expiresAt) => {
      clearTimeout(expiryTimer);
      if (!expiresAt) return;
      const wait = Math.max(0, expiresAt.getTime() + graceMs - clock.now().getTime());
      expiryTimer = setTimeout(() => {
        socket.emit('auth.expired', { reason: 'token_expired' });
        socket.disconnect(true);
      }, wait);
      expiryTimer.unref?.();
    };
    scheduleExpiry(user.expiresAt);
    void socket.join(userRoom(user.userId));
    void each('onConnect', ctx);
    socket.conn.on('heartbeat', () => void each('onHeartbeat', ctx));

    socket.on(
      'auth.refresh',
      async (/** @type {unknown} */ payload, /** @type {unknown} */ ack) => {
        const requestId = randomUUID();
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const parsed = clientEvents.get('auth.refresh')?.payload.safeParse(payload);
          if (!parsed?.success) throw new AppError('VALIDATION_FAILED');
          const { token } = /** @type {{ token: string }} */ (parsed.data);
          const principal = await verifier.verify(token, AUDIENCE.USER);
          // A refresh may extend this session only, never switch the socket to another user.
          if (principal.userId !== user.userId) throw new AppError('UNAUTHENTICATED');
          socket.data.user = principal;
          scheduleExpiry(principal.expiresAt);
          reply({ ok: true, expiresAt: (principal.expiresAt ?? clock.now()).toISOString() });
        } catch (error) {
          reply(ackError(error, requestId));
        }
      },
    );

    for (const [event, { handle }] of handlers) {
      const definition = clientEvents.get(event);
      socket.on(event, async (/** @type {unknown} */ payload, /** @type {unknown} */ ack) => {
        const requestId = randomUUID();
        const reply = typeof ack === 'function' ? ack : null;
        await runWithContext({ requestId, traceId: requestId }, async () => {
          try {
            const parsed = definition?.payload.safeParse(payload);
            if (!parsed?.success) {
              throw new AppError('VALIDATION_FAILED', {
                details: {
                  issues: (parsed?.error?.issues ?? []).map((i) => ({
                    path: i.path.join('.'),
                    message: i.message,
                  })),
                },
              });
            }
            const result = await handle(parsed.data, ctx);
            if (reply && definition?.ack) reply({ ok: true, .../** @type {object} */ (result) });
          } catch (error) {
            const appError = normaliseError(error);
            if (appError.status >= 500) logger.error({ err: error, event }, 'socket event failed');
            if (reply) reply(ackError(appError, requestId));
          }
        });
      });
    }

    socket.on('disconnect', async () => {
      clearTimeout(expiryTimer);
      // This process's sockets only (no cluster round trip): a user connected through another
      // gateway refreshes their presence there within one heartbeat.
      const remaining = (await io.in(userRoom(user.userId)).local.fetchSockets()).length;
      for (const { module, handlers: set } of modules) {
        try {
          await set.onDisconnect?.(ctx, remaining);
        } catch (err) {
          logger.warn({ err, module }, 'socket disconnect hook failed');
        }
      }
    });
  });

  return {
    io,
    /**
     * Graceful shutdown: refuse new connections, then disconnect this process's sockets spread
     * over up to 20 s (inside `drainMs`) so clients reconnect elsewhere gradually.
     * @param {number} drainMs
     */
    async drain(drainMs) {
      draining = true;
      const sockets = await io.local.fetchSockets();
      const spread = Math.min(DRAIN_SPREAD_MS, Math.max(0, drainMs * 0.8 - 1000));
      await Promise.all(
        sockets.map(
          (socket, i) =>
            new Promise((resolve) => {
              const timer = setTimeout(
                () => {
                  socket.disconnect(true);
                  resolve(undefined);
                },
                sockets.length > 1 ? (spread * i) / (sockets.length - 1) : 0,
              );
              timer.unref?.();
            }),
        ),
      );
      io.engine.close();
    },
  };
}

/** @typedef {ReturnType<typeof createSocketGateway>} SocketGateway */
