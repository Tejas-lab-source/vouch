// @ts-check
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/platform/config.js';
import { buildHttpServer } from '../../src/platform/http.js';
import { createMetrics } from '../../src/platform/metrics.js';
import { createPressureGauge } from '../../src/platform/pressure.js';
import { makeKeys, testEnv } from './helpers.js';

/** A busy loop: holds the event loop for `ms`. @param {number} ms */
const block = (ms) => {
  const until = performance.now() + ms;
  while (performance.now() < until);
};

describe('overload protection (Phase 14)', () => {
  it('reports heap pressure above the ratio, and event-loop pressure above the delay', async () => {
    let used = 10;
    const gauge = createPressureGauge({
      maxEventLoopDelayMs: 50,
      maxHeapRatio: 0.8,
      heapLimitBytes: 100,
      heapUsed: () => used,
      windowMs: 60_000,
    });
    try {
      gauge.sample();
      expect(gauge.overloaded()).toBeNull();
      used = 90;
      gauge.sample();
      expect(gauge.overloaded()).toBe('heap');
      used = 10;
      // A blocked loop: the delay histogram records it once the loop turns again.
      for (let i = 0; i < 5; i += 1) {
        block(200);
        await new Promise((resolve) => setImmediate(resolve));
      }
      gauge.sample();
      expect(gauge.overloaded()).toBe('event_loop');
      gauge.sample(); // a calm window clears it
      expect(gauge.overloaded()).toBeNull();
    } finally {
      gauge.stop();
    }
  });

  it('caps requests in progress: past the cap, new requests get 503 at once', async () => {
    const keys = await makeKeys();
    const config = loadConfig(
      testEnv({
        DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
        REDIS_URL: 'redis://127.0.0.1:1',
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
        PRESSURE_MAX_IN_FLIGHT: '2',
      }),
    );
    const app = await buildHttpServer({
      config,
      logger: pino({ level: 'silent' }),
      verifier: /** @type {any} */ ({ verify: async () => ({}) }),
      redis: /** @type {any} */ (undefined),
      readiness: /** @type {any} */ ({ check: async () => ({ status: 'ready', checks: {} }) }),
      metrics: createMetrics(),
      apiRoutes: false,
    });
    /** @type {(() => void)[]} */
    const release = [];
    app.get(
      '/slow',
      { config: { auth: 'public' } },
      () =>
        new Promise((resolve) => {
          release.push(() => resolve({ ok: true }));
        }),
    );
    try {
      const held = [
        app.inject({ method: 'GET', url: '/slow' }),
        app.inject({ method: 'GET', url: '/slow' }),
      ];
      await new Promise((resolve) => setTimeout(resolve, 50));
      const third = await app.inject({ method: 'GET', url: '/slow' });
      expect(third.statusCode).toBe(503);
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      for (const r of release) r();
      expect((await Promise.all(held)).map((r) => r.statusCode)).toEqual([200, 200]);
      // Capacity is back once they finish.
      const after = app.inject({ method: 'GET', url: '/slow' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      release.at(-1)?.();
      expect((await after).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('under pressure, new requests get 503 with Retry-After; health checks still answer', async () => {
    const keys = await makeKeys();
    const config = loadConfig(
      testEnv({
        DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
        REDIS_URL: 'redis://127.0.0.1:1',
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
      }),
    );
    const metrics = createMetrics();
    /** @type {null | 'heap'} */
    let reason = null;
    const app = await buildHttpServer({
      config,
      logger: pino({ level: 'silent' }),
      verifier: /** @type {any} */ ({ verify: async () => ({}) }),
      redis: /** @type {any} */ (undefined),
      readiness: /** @type {any} */ ({ check: async () => ({ status: 'ready', checks: {} }) }),
      metrics,
      apiRoutes: false,
      pressure: /** @type {any} */ ({ overloaded: () => reason, sample: () => {}, stop: () => {} }),
    });
    try {
      app.get('/probe', { config: { auth: 'public' } }, async () => ({ ok: true }));
      expect((await app.inject({ method: 'GET', url: '/probe' })).statusCode).toBe(200);
      reason = 'heap';
      const shed = await app.inject({ method: 'GET', url: '/probe' });
      expect(shed.statusCode).toBe(503);
      expect(shed.headers['retry-after']).toBe('5');
      expect(shed.json().error.code).toBe('TEMPORARILY_UNAVAILABLE');
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      expect(await metrics.registry.metrics()).toContain(
        'vouch_shed_total{kind="http",reason="heap"} 1',
      );
    } finally {
      await app.close();
    }
  });
});
