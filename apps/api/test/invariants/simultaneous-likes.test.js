// @ts-check
import { randomUUID } from 'node:crypto';
import { swipe as swipeEndpoint } from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../scripts/seed.js';
import modules from '../../src/modules/index.js';
import { createPlatform, startRole } from '../../src/platform/boot.js';
import { loadConfig } from '../../src/platform/config.js';
import { createLogger } from '../../src/platform/logger.js';
import { HOOK_TIMEOUT_MS, makeKeys, startInfra, testEnv } from '../platform/helpers.js';

const PAIRS = 1000;
/** Pairs swiped at the same time: 40 concurrent like requests. */
const WAVE = 20;
const H = { 'x-app-version': '1.0.0', 'content-type': 'application/json' };

/** @param {number[]} sorted @param {number} p */
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;

describe('invariant: simultaneous likes create exactly one match (1,000 fresh pairs)', () => {
  /** @type {import('../platform/helpers.js').Infra} */
  let infra;
  /** @type {any} */
  let app;
  /** @type {import('../platform/helpers.js').TestKeys} */
  let keys;
  /** @type {number[]} */
  const lockHolds = [];

  beforeAll(async () => {
    infra = await startInfra();
    keys = await makeKeys({ kid: 'active-1' });
    await seed(infra.admin);
    const config = loadConfig(
      testEnv({
        // REST only (Phase 14): the burst's 1,000 match.created events are counted in the outbox,
        // not consumed. Since Phase 13 three modules consume them; with workers in this process
        // they compete with the burst and skew the lock-hold timing this test measures (the
        // isolation Phase 8 chose for the same reason).
        ROLE: 'api',
        DATABASE_URL: infra.appUrl,
        DATABASE_POOL_MAX: '20',
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
      }),
    );
    const platform = await createPlatform({ config, logger: createLogger({ level: 'silent' }) });
    app = await startRole({
      platform: /** @type {any} */ ({
        ...platform,
        overrides: {
          matching: { observeLockHold: (/** @type {number} */ ms) => lockHolds.push(ms) },
        },
      }),
      modules,
      listen: false,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.stop(10_000);
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('both users like each other at the same instant: one match, one match.created.v1, every time', async () => {
    const users = await infra.admin`SELECT u.id, u.public_id FROM identity.users u
        JOIN profiles.profiles p ON p.user_id = u.id WHERE p.status = 'active' ORDER BY u.id`;
    expect(users.length).toBeGreaterThanOrEqual(PAIRS * 2);
    const pairs = Array.from({ length: PAIRS }, (_, i) => [users[2 * i], users[2 * i + 1]]);
    const redis = app.platform.redis.command;
    const served = redis.multi();
    for (const [a, b] of pairs) {
      served.sadd(`discovery:served:${a.id}`, b.id).sadd(`discovery:served:${b.id}`, a.id);
    }
    await served.exec();
    const tokens = new Map(
      await Promise.all(
        users
          .slice(0, PAIRS * 2)
          .map(
            async (/** @type {any} */ u) =>
              /** @type {[string, string]} */ ([
                u.id,
                await keys.sign({ sub: u.id, sid: randomUUID() }),
              ]),
          ),
      ),
    );
    /** @param {any} from @param {any} to */
    const like = (from, to) =>
      app.http.inject({
        method: 'POST',
        url: '/v1/swipes',
        headers: { ...H, authorization: `Bearer ${tokens.get(from.id)}` },
        payload: { swipeId: randomUUID(), targetId: to.public_id, direction: 'like' },
      });

    /** @type {{ matchedTrue: number, statuses: number[] }[]} */
    const outcomes = [];
    const started = performance.now();
    for (let i = 0; i < pairs.length; i += WAVE) {
      const wave = pairs.slice(i, i + WAVE);
      const replies = await Promise.all(
        wave.map(async ([a, b]) => Promise.all([like(a, b), like(b, a)])),
      );
      for (const pair of replies) {
        const bodies = pair.map((r) => swipeEndpoint.response.schema.parse(r.json()));
        outcomes.push({
          matchedTrue: bodies.filter((body) => body.matched).length,
          statuses: pair.map((r) => r.statusCode),
        });
      }
    }
    const seconds = (performance.now() - started) / 1000;

    const matches = await infra.admin`SELECT user_low, user_high, count(*)::int AS n
        FROM matching.matches GROUP BY user_low, user_high`;
    const events =
      await infra.admin`SELECT payload->>'userLow' AS low, payload->>'userHigh' AS high,
          count(*)::int AS n
        FROM platform.outbox WHERE name = 'match.created.v1' GROUP BY 1, 2`;
    const perPair = outcomes.filter((o) => o.matchedTrue === 1).length;
    const sorted = [...lockHolds].sort((x, y) => x - y);
    const report = {
      pairs: PAIRS,
      seconds: Math.round(seconds * 10) / 10,
      pairsWithExactlyOneMatchedResponse: perPair,
      matchRows: matches.length,
      maxMatchesPerPair: Math.max(...matches.map((m) => m.n)),
      matchCreatedEvents: events.reduce((sum, e) => sum + e.n, 0),
      maxEventsPerPair: Math.max(...events.map((e) => e.n)),
      lockHoldMs: {
        samples: sorted.length,
        p50: Number(percentile(sorted, 0.5).toFixed(2)),
        p95: Number(percentile(sorted, 0.95).toFixed(2)),
        p99: Number(percentile(sorted, 0.99).toFixed(2)),
        max: Number((sorted.at(-1) ?? 0).toFixed(2)),
      },
    };
    process.stdout.write(`PHASE8_INVARIANT ${JSON.stringify(report)}\n`);

    expect(new Set(outcomes.flatMap((o) => o.statuses))).toEqual(new Set([200]));
    expect(perPair).toBe(PAIRS);
    expect(report.matchRows).toBe(PAIRS);
    expect(report.maxMatchesPerPair).toBe(1);
    expect(events).toHaveLength(PAIRS);
    expect(report.maxEventsPerPair).toBe(1);
    expect(report.lockHoldMs.samples).toBe(PAIRS * 2);
    expect(report.lockHoldMs.p95).toBeLessThan(20);
  }, 600_000);
});
