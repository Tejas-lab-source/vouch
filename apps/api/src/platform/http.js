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
import { randomUUID } from 'node:crypto';
import { authHook } from './auth.js';
import { enterContext } from './context.js';
import { AppError, createErrorHandler, notFoundHandler } from './errors.js';
import { compareVersions } from './flags.js';
import { registerHealthRoutes } from './health.js';

/** Upper bound for receiving a whole request. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Default per-client limit; routes can set their own through `config.rateLimit`. */
const DEFAULT_RATE_LIMIT = { max: 300, timeWindow: 60_000 };

/**
 * @typedef {object} HttpServerOptions
 * @property {import('./config.js').Config} config
 * @property {import('pino').Logger} logger
 * @property {import('./auth.js').TokenVerifier} verifier
 * @property {import('ioredis').Redis} redis  Backs the rate limiter.
 * @property {ReturnType<import('./health.js').createReadiness>} readiness
 * @property {import('./metrics.js').Metrics} metrics
 * @property {(error: unknown) => void} [reportError]
 * @property {boolean} [apiRoutes]  false for the ws and worker roles (health only).
 * @property {{ module: string, plugin: any }[]} [routes]  Module route plugins.
 */

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
  reportError,
  apiRoutes = true,
  routes = [],
}) {
  // Cast: Fastify types the instance by pino's Logger, which is wider than FastifyBaseLogger.
  const app = /** @type {import('fastify').FastifyInstance} */ (
    /** @type {unknown} */ (
      Fastify({
        loggerInstance: logger,
        requestTimeout: REQUEST_TIMEOUT_MS,
        requestIdHeader: 'x-request-id',
        genReqId: () => randomUUID(),
        trustProxy: true,
      })
    )
  );
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(createErrorHandler(reportError));
  app.setNotFoundHandler(notFoundHandler);

  app.addHook('onRequest', async (request) => {
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

  await app.register(helmet, { global: true });
  await app.register(cors, { origin: config.CORS_ORIGINS, credentials: true });
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(rateLimit, {
    global: true,
    ...DEFAULT_RATE_LIMIT,
    redis,
    nameSpace: 'platform:rl:',
    skipOnError: true,
    allowList: (request) => request.url === '/health' || request.url === '/ready',
  });

  registerHealthRoutes(app, { readiness });
  if (!apiRoutes) return app;

  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: { info: { title: 'Vouch API', version: '1.0.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.addHook(
    'onRequest',
    authHook({ verifier, adminIpAllowlist: config.ADMIN_IP_ALLOWLIST ?? [] }),
  );
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
