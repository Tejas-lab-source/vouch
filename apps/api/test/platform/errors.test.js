// @ts-check
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  createErrorHandler,
  notFoundHandler,
  toErrorResponse,
} from '../../src/platform/errors.js';

/** @param {(error: unknown) => void} [report] */
function appWithErrors(report) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(createErrorHandler(report));
  app.setNotFoundHandler(notFoundHandler);
  app.post('/v', { schema: { body: z.strictObject({ n: z.int() }) } }, async () => ({ ok: true }));
  app.get('/app-error', async () => {
    throw new AppError('BLOCKED', { details: { reason: 'x' } });
  });
  app.get('/boom', async () => {
    throw new Error('secret internal detail');
  });
  app.get('/limited', async () => {
    throw Object.assign(new Error('rate'), { statusCode: 429 });
  });
  return app;
}

describe('AppError', () => {
  it('takes its HTTP status from the contracts', () => {
    expect(new AppError('NOT_SERVED').status).toBe(409);
    expect(new AppError('UNAUTHENTICATED').message).toBe('Sign in to continue.');
  });

  it('maps unknown errors to INTERNAL without leaking the message', () => {
    const { status, body } = toErrorResponse(new Error('db password is hunter2'), 'req-1');
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-1' },
    });
  });
});

describe('Fastify error handling', () => {
  it('returns the envelope for AppErrors', async () => {
    const response = await appWithErrors().inject({ url: '/app-error' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'BLOCKED', details: { reason: 'x' } } });
  });

  it('turns validation failures into VALIDATION_FAILED with field paths', async () => {
    const response = await appWithErrors().inject({
      method: 'POST',
      url: '/v',
      payload: { n: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details.issues.length).toBeGreaterThan(0);
  });

  it('turns malformed JSON into VALIDATION_FAILED and rate limits into RATE_LIMITED', async () => {
    const app = appWithErrors();
    const bad = await app.inject({
      method: 'POST',
      url: '/v',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    expect((await app.inject({ url: '/limited' })).json().error.code).toBe('RATE_LIMITED');
  });

  it('returns a generic 500 without stack traces, and reports it', async () => {
    const report = vi.fn();
    const response = await appWithErrors(report).inject({ url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret internal detail');
    expect(response.body).not.toContain('at ');
    expect(report).toHaveBeenCalledOnce();
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const response = await appWithErrors().inject({ url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
