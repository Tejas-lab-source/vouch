// @ts-check
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { trace } from '@opentelemetry/api';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { authHooks } from './auth.js';
import { clientIpOf, createProxyTrust, resolveClientIp } from './client-ip.js';
import { enterContext } from './context.js';
import { AppError, createErrorHandler, notFoundHandler } from './errors.js';
import { compareVersions } from './flags.js';
import { registerHealthRoutes } from './health.js';

/** Upper bound for receiving a whole request. */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Largest accepted request body (Phase 14 security review). Every contract body is far smaller
 * (the largest, a profile section, is a few KB); files go straight to storage.
 */
export const BODY_LIMIT_BYTES = 64 * 1024;
/** Global limiter window; the limits come from config (ADR 0015). */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * The global limiter's key: the user for signed-in requests, the client IP otherwise
 * (including requests whose token is missing or bad, so floods of bad tokens are throttled).
 * @param {import('fastify').FastifyRequest & { user?: { userId: string } | null }} request
 */
export const rateLimitKey = (request) =>
  request.user ? `user:${request.user.userId}` : `ip:${clientIpOf(request)}`;

/**
 * @typedef {object} HttpServerOptions
 * @property {import('./config.js').Config} config
 * @property {import('pino').Logger} logger
 * @property {import('./auth.js').TokenVerifier} verifier
 * @property {import('ioredis').Redis} redis  Backs the rate limiter.
 * @property {ReturnType<import('./health.js').createReadiness>} readiness
 * @property {import('./metrics.js').Metrics} metrics
 * @property {{ collect: () => Promise<void> }} [ops]  Refreshes the operational gauges before a scrape.
 * @property {(error: unknown) => void} [reportError]
 * @property {boolean} [apiRoutes]  false for the ws and worker roles (health only).
 * @property {{ module: string, plugin: any }[]} [routes]  Module route plugins.
 * @property {import('./pressure.js').PressureGauge} [pressure]  Sheds new requests under
 *   overload (503, Retry-After); health checks are never shed.
 */

/** Health checks and the metrics scrape: never shed or rate-limited. @param {string} url */
const isOperational = (url) =>
  url === '/health' || url === '/ready' || url === SCRAPE_PATH || url.startsWith(`${SCRAPE_PATH}?`);

/** Grafana Cloud scrapes the public port here (Phase 15); the internal port keeps /metrics. */
export const SCRAPE_PATH = '/internal/metrics';

/** @param {string} value */
const digest = (value) => createHash('sha256').update(value).digest();

/**
 * `GET /internal/metrics`: the Prometheus text, for a bearer token compared in constant time.
 * Any other request gets the same 404 as an unknown route, so the path reveals nothing.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ metrics: import('./metrics.js').Metrics, ops?: { collect: () => Promise<void> }, token: string }} deps
 */
function registerScrapeRoute(app, { metrics, ops, token }) {
  const expected = digest(`Bearer ${token}`);
  app.get(
    SCRAPE_PATH,
    { logLevel: 'silent', config: { auth: 'public' } },
    async (request, reply) => {
      const given = request.headers.authorization;
      if (typeof given !== 'string' || !timingSafeEqual(digest(given), expected)) {
        notFoundHandler(request, reply);
        return reply;
      }
      await ops?.collect();
      reply.header('cache-control', 'no-store').type(metrics.registry.contentType);
      return metrics.registry.metrics();
    },
  );
}

/**
 * Builds the public HTTP server: security headers, CORS allowlist, cookies, Redis-backed rate
 * limiting, zod validation and serialisation, auth, the error envelope, health routes, and
 * (outside production) Swagger at /docs.
 * @param {HttpServerOptions} options
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildHttpServer({
  config,
  logger,
  verifier,
  redis,
  readiness,
  metrics,
  ops,
  reportError,
  apiRoutes = true,
  routes = [],
  pressure,
}) {
  const proxyTrust = createProxyTrust(config.TRUSTED_PROXIES);
  // Cast: Fastify types the instance by pino's Logger, which is wider than FastifyBaseLogger.
  const app = /** @type {import('fastify').FastifyInstance} */ (
    /** @type {unknown} */ (
      Fastify({
        loggerInstance: logger,
        requestTimeout: REQUEST_TIMEOUT_MS,
        bodyLimit: BODY_LIMIT_BYTES,
        requestIdHeader: 'x-request-id',
        genReqId: () => randomUUID(),
        trustProxy: config.TRUSTED_PROXIES.length > 0 ? proxyTrust.trustProxy : false,
      })
    )
  );
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(createErrorHandler(reportError));
  app.setNotFoundHandler(notFoundHandler);

  app.decorateRequest('clientIp', '');
  app.addHook('onRequest', async (request) => {
    /** @type {any} */ (request).clientIp = resolveClientIp(request, proxyTrust);
    const span = trace.getActiveSpan();
    enterContext({ requestId: request.id, traceId: span?.spanContext().traceId ?? request.id });
  });
  app.addHook('onResponse', async (request, reply) => {
    metrics.observeHttp({
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      statusCode: reply.statusCode,
      seconds: reply.elapsedTime / 1000,
    });
  });

  // Overload: refuse new work before it is parsed, so accepted work can finish (Phase 14).
  // Besides the process signals (event-loop delay, heap), requests in progress are capped:
  // when the database is the bottleneck the process looks healthy while requests queue for
  // connections, and an immediate 503 beats a 60 s timeout.
  let inFlight = 0;
  app.addHook('onRequest', async (request, reply) => {
    if (isOperational(request.url)) return;
    const reason =
      pressure?.overloaded() ?? (inFlight >= config.PRESSURE_MAX_IN_FLIGHT ? 'in_flight' : null);
    if (reason) {
      metrics.countShed('http', reason);
      reply.header('retry-after', '5');
      throw new AppError('TEMPORARILY_UNAVAILABLE');
    }
    inFlight += 1;
    reply.raw.once('close', () => {
      inFlight -= 1;
    });
  });

  await app.register(helmet, { global: true });
  // The web and admin apps call the API from their own origins (Phase 15). The plugin's
  // default methods are GET, HEAD and POST only; every method a route uses must be listed, or
  // the browser's preflight refuses PATCH, PUT and DELETE.
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  // The limiter's hook is route-level, so it runs after the app-level `authenticate` hook below
  // and before `enforce` rejects unauthenticated requests.
  const auth = authHooks({
    verifier,
    adminIpAllowlist: config.ADMIN_IP_ALLOWLIST ?? [],
    clientIp: clientIpOf,
  });
  await app.register(rateLimit, {
    global: true,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    keyGenerator: rateLimitKey,
    max: (_request, key) =>
      key.startsWith('user:') ? config.RATE_LIMIT_USER_MINUTE : config.RATE_LIMIT_IP_MINUTE,
    redis,
    nameSpace: 'platform:rl:',
    skipOnError: true,
    allowList: (request) => isOperational(request.url),
  });

  registerHealthRoutes(app, { readiness });
  if (config.METRICS_SCRAPE_TOKEN) {
    registerScrapeRoute(app, { metrics, ops, token: config.METRICS_SCRAPE_TOKEN });
  }
  if (!apiRoutes) return app;

  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: { info: { title: 'Vouch API', version: '1.0.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.addHook('onRequest', auth.authenticate);
  app.addHook('preValidation', auth.enforce);
  app.addHook('onRequest', async (request) => {
    const version = request.headers['x-app-version'];
    if (typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version)) {
      if (compareVersions(version, config.APP_MIN_SUPPORTED_VERSION) < 0) {
        throw new AppError('APP_VERSION_UNSUPPORTED');
      }
    }
  });

  for (const { plugin } of routes) await app.register(plugin);
  return app;
}
