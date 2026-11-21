// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  /** @type {import('fastify').FastifyInstance | undefined} */
  let app;

  afterEach(async () => {
    await app?.close();
  });

  it('returns 200 with { status: "ok" }', async () => {
    app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
  });
});
