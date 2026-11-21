// @ts-check
import { EVENTS } from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import exampleModule from '../../src/modules/_example/manifest.js';
import { EXAMPLE_EVENTS } from '../../src/modules/_example/contract.js';
import { createPlatform, startRole } from '../../src/platform/boot.js';
import { loadConfig } from '../../src/platform/config.js';
import { createLogger } from '../../src/platform/logger.js';
import { eventually, HOOK_TIMEOUT_MS, makeKeys, startInfra, testEnv } from './helpers.js';

describe('_example module end to end: HTTP → use case → outbox → relay → consumer → inbox', () => {
  /** @type {import('./helpers.js').Infra} */
  let infra;
  /** @type {import('../../src/platform/boot.js').Runtime} */
  let runtime;
  /** @type {{ noteId: string, text: string, traceId: string | null, eventId: number, at: number }[]} */
  const sink = [];

  beforeAll(async () => {
    infra = await startInfra();
    const keys = await makeKeys();
    const config = loadConfig(
      testEnv({
        ROLE: 'all',
        DATABASE_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
      }),
    );
    const platform = await createPlatform({
      config,
      logger: createLogger({ level: 'silent' }),
      extraDbModules: ['example'],
    });
    runtime = await startRole({
      platform: /** @type {any} */ ({
        ...platform,
        exampleSink: {
          record: (/** @type {any} */ e) => sink.push({ ...e, at: performance.now() }),
        },
      }),
      modules: [exampleModule],
      events: { ...EVENTS, ...EXAMPLE_EVENTS },
      listen: false,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await runtime?.stop(10_000);
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('carries one trace id through every hop, and records the sequence', async () => {
    const sentAt = performance.now();
    const response = await runtime.http.inject({
      method: 'POST',
      url: '/example/notes',
      headers: {
        'x-request-id': 'req-e2e-1',
        'idempotency-key': 'idem-e2e-0001',
        'x-app-version': '1.0.0',
      },
      payload: { text: '  hello   kernel  ' },
    });
    expect(response.statusCode).toBe(201);
    const { noteId } = response.json();

    const seen = await eventually(() => sink.find((entry) => entry.noteId === noteId), 15_000);
    const [outbox] =
      await infra.admin`SELECT id, name, trace_id, published_at FROM platform.outbox WHERE payload->>'noteId' = ${noteId}`;
    const inbox =
      await infra.admin`SELECT consumer FROM platform.inbox WHERE event_id = ${outbox.id}`;

    expect(seen.text).toBe('hello kernel');
    expect(outbox.trace_id).toBe('req-e2e-1');
    expect(seen.traceId).toBe('req-e2e-1');
    expect(seen.eventId).toBe(Number(outbox.id));
    expect(outbox.published_at).not.toBeNull();
    expect(inbox.map((r) => r.consumer)).toEqual(['example']);

    const latencyMs = Math.round(seen.at - sentAt);
    process.stdout.write(
      [
        '',
        'E2E sequence (trace id carried through):',
        `  1. HTTP POST /example/notes    requestId=req-e2e-1 → 201 noteId=${noteId}`,
        `  2. use case → outbox row       id=${outbox.id} name=${outbox.name} trace_id=${outbox.trace_id}`,
        `  3. relay → evt.example         jobId=example-${outbox.id} published_at set`,
        `  4. consumer → handler          traceId=${seen.traceId} eventId=${seen.eventId}`,
        `  5. inbox                       (example, ${outbox.id})`,
        `  latency (request sent → consumer ran): ${latencyMs} ms`,
        '',
      ].join('\n'),
    );
  }, 30_000);

  it('a retried POST with the same idempotency key returns the same note and writes one event', async () => {
    const send = () =>
      runtime.http.inject({
        method: 'POST',
        url: '/example/notes',
        headers: { 'idempotency-key': 'idem-e2e-0002' },
        payload: { text: 'once' },
      });
    const first = await send();
    const second = await send();
    expect(second.json()).toEqual(first.json());
    const rows =
      await infra.admin`SELECT id FROM platform.outbox WHERE payload->>'noteId' = ${first.json().noteId}`;
    expect(rows).toHaveLength(1);
  });

  it('measures relay latency over 20 events (event written → consumer ran)', async () => {
    /** @type {number[]} */
    const latencies = [];
    for (let i = 0; i < 20; i += 1) {
      const sentAt = performance.now();
      const response = await runtime.http.inject({
        method: 'POST',
        url: '/example/notes',
        payload: { text: `note ${i}` },
      });
      const { noteId } = response.json();
      const seen = await eventually(() => sink.find((entry) => entry.noteId === noteId), 15_000);
      latencies.push(seen.at - sentAt);
    }
    latencies.sort((a, b) => a - b);
    const p50 = Math.round(latencies[Math.floor(latencies.length * 0.5)] ?? 0);
    const p95 = Math.round(latencies[Math.floor(latencies.length * 0.95)] ?? 0);
    process.stdout.write(
      `Relay latency over 20 sequential events: p50=${p50} ms, p95=${p95} ms, max=${Math.round(latencies.at(-1) ?? 0)} ms\n`,
    );
    expect(p95).toBeLessThan(3_000);
  }, 120_000);

  it('rejects invalid input with the error envelope', async () => {
    const response = await runtime.http.inject({
      method: 'POST',
      url: '/example/notes',
      payload: { text: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });
});
