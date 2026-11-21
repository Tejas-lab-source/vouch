// @ts-check
import Fastify from 'fastify';

/** Upper bound for receiving a whole request, in milliseconds. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Response schema for `GET /health`; serialisation drops any other field. */
const healthResponse = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['ok'] } },
  required: ['status'],
  additionalProperties: false,
};

/**
 * Builds the Fastify application without binding a port, so tests can use `inject`.
 * @param {{ logger?: import('fastify').FastifyServerOptions['logger'] }} [options]
 * @returns {import('fastify').FastifyInstance}
 */
export function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    requestTimeout: REQUEST_TIMEOUT_MS,
  });

  app.get('/health', { schema: { response: { 200: healthResponse } } }, async () => ({
    status: 'ok',
  }));

  return app;
}
