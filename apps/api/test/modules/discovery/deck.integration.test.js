// @ts-check
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { getDeck, ProfileCard } from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../../scripts/seed.js';
import modules from '../../../src/modules/index.js';
import { createBuildQueue } from '../../../src/modules/discovery/adapters/jobs/builds.js';
import { createPlatform, startRole } from '../../../src/platform/boot.js';
import { loadConfig } from '../../../src/platform/config.js';
import { createJobs } from '../../../src/platform/jobs.js';
import { uuidv7 } from '../../../src/platform/ids.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  eventually,
  HOOK_TIMEOUT_MS,
  makeKeys,
  startInfra,
  testEnv,
} from '../../platform/helpers.js';

const H = { 'x-app-version': '1.0.0' };
const WAIT_MS = 20_000;

describe('safety and discovery (ROLE=all, the 2,000-user seed)', () => {
  /** @type {import('../../platform/helpers.js').Infra} */
  let infra;
  /** @type {import('../../platform/helpers.js').TestKeys} */
  let keys;
  /** @type {any} */
  let app;
  /** @type {import('ioredis').Redis} */
  let redis;
  /** @type {string[]} */
  const logLines = [];
  /** @type {any[]} */
  let seeded;

  /** @param {string} userId */
  const auth = async (userId) => ({
    ...H,
    authorization: `Bearer ${await keys.sign({ sub: userId, sid: randomUUID() })}`,
  });
  /** @param {string} userId */
  const deck = async (userId) => {
    const response = await app.http.inject({ url: '/v1/deck', headers: await auth(userId) });
    return { status: response.statusCode, body: response.json() };
  };
  /** A deck that exists in Redis (the first request only queues the build). */
  const deckReady = async (/** @type {string} */ userId) => {
    const first = await deck(userId);
    expect(first.status).toBe(200);
    await eventually(async () => (await redis.exists(`discovery:deck:${userId}`)) === 1, WAIT_MS);
    return first;
  };
  /** @param {string} publicId */
  const internalId = async (publicId) =>
    (await infra.admin`SELECT id FROM identity.users WHERE public_id = ${publicId}`)[0]?.id;
  let next = 0;
  /** A different seeded viewer for each test, so decks never interfere. */
  const viewer = () => seeded[next++];

  beforeAll(async () => {
    infra = await startInfra();
    keys = await makeKeys({ kid: 'active-1' });
    await seed(infra.admin);
    seeded =
      await infra.admin`SELECT u.id, u.public_id, p.gender, p.interested_in, p.min_age, p.max_age,
        date_part('year', age(current_date, p.birth_date))::int AS age, p.cluster_id
      FROM identity.users u JOIN profiles.profiles p ON p.user_id = u.id ORDER BY u.id LIMIT 40`;
    const config = loadConfig(
      testEnv({
        ROLE: 'all',
        LOG_LEVEL: 'debug',
        DATABASE_URL: infra.appUrl,
        DATABASE_REPLICA_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
      }),
    );
    const destination = new Writable({
      write(chunk, _e, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    const platform = await createPlatform({
      config,
      logger: createLogger({ level: 'debug', destination }),
    });
    app = await startRole({ platform, modules, listen: false });
    redis = app.platform.redis.command;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.stop(10_000);
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('the first request returns cards: [] and queues a build; then 10 eligible, valid cards', async () => {
    const v = viewer();
    const first = await deckReady(v.id);
    expect(first.body).toEqual({ cards: [] });
    const page = await deck(v.id);
    expect(page.status).toBe(200);
    const { cards } = getDeck.response.schema.parse(page.body);
    expect(cards).toHaveLength(10);
    for (const card of cards) {
      ProfileCard.parse(card);
      const [c] =
        await infra.admin`SELECT p.gender, p.interested_in, p.min_age, p.max_age, p.cluster_id,
          date_part('year', age(current_date, p.birth_date))::int AS age
        FROM identity.users u JOIN profiles.profiles p ON p.user_id = u.id WHERE u.public_id = ${card.userId}`;
      expect(card.userId).not.toBe(v.public_id);
      expect(c.cluster_id).toBe(v.cluster_id);
      expect(v.interested_in).toContain(c.gender);
      expect(c.interested_in).toContain(v.gender);
      expect(c.age).toBeGreaterThanOrEqual(v.min_age);
      expect(c.age).toBeLessThanOrEqual(v.max_age);
      expect(v.age).toBeGreaterThanOrEqual(c.min_age);
      expect(v.age).toBeLessThanOrEqual(c.max_age);
    }
    // Ordering is explained at debug level by each scorer's reason.
    const built = logLines
      .map((l) => JSON.parse(l))
      .find((l) => l.msg === 'deck built' && l.viewerId === v.id);
    expect(built.deck[0].reasons.join(' ')).toMatch(/discovery\.recency=.*discovery\.exposureCap=/);
    // Served ids are recorded for matching, and one deck.served.v1 is emitted for the page.
    const shown = await Promise.all(cards.map((/** @type {any} */ c) => internalId(c.userId)));
    expect(await app.boot.apis.get('discovery').wasServed(v.id, shown[0])).toBe(true);
    const events = await infra.admin`SELECT payload FROM platform.outbox
      WHERE name = 'deck.served.v1' AND payload->>'viewerId' = ${v.id}`;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.targetIds).toEqual(shown);
  });

  it('block invariant: a blocked user never appears, even straight after the block with a stale deck', async () => {
    const v = viewer();
    await deckReady(v.id);
    const [target] = await redis.lrange(`discovery:deck:${v.id}`, 0, 0);
    const [t] = await infra.admin`SELECT public_id FROM identity.users WHERE id = ${target}`;
    const blocked = await app.http.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: { ...(await auth(v.id)), 'content-type': 'application/json' },
      payload: { targetId: t.public_id },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json()).toEqual({ blocked: true });

    // Immediately, in both directions.
    const policy = app.boot.apis.get('safety').blockPolicy;
    expect(await policy.isBlocked(v.id, target)).toBe(true);
    expect(await policy.isBlocked(target, v.id)).toBe(true);
    // Stale decks: put each at the head of the other's deck before any consumer can run.
    await redis.lpush(`discovery:deck:${v.id}`, target);
    await redis.lpush(`discovery:deck:${target}`, v.id);
    await redis.expire(`discovery:deck:${target}`, 3600);
    const page = await deck(v.id);
    expect(page.body.cards.map((/** @type {any} */ c) => c.userId)).not.toContain(t.public_id);
    const theirs = await deck(target);
    expect(theirs.body.cards.map((/** @type {any} */ c) => c.userId)).not.toContain(v.public_id);

    // Still true after Redis loses the sets (falls back to Postgres and reloads).
    await redis.del(`safety:blocked:${v.id}`, `safety:blocked:${target}`);
    expect(await policy.isBlocked(target, v.id)).toBe(true);
    expect(await redis.sismember(`safety:blocked:${target}`, v.id)).toBe(1);
    // Blocking twice is a no-op with one event; the consumer removes the pair from both decks.
    await app.http.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: { ...(await auth(v.id)), 'content-type': 'application/json' },
      payload: { targetId: t.public_id },
    });
    const events = await infra.admin`SELECT 1 FROM platform.outbox
      WHERE name = 'user.blocked.v1' AND payload->>'blockerId' = ${v.id}`;
    expect(events).toHaveLength(1);
    await redis.lpush(`discovery:deck:${v.id}`, target);
    await eventually(
      async () => !(await redis.lrange(`discovery:deck:${v.id}`, 0, -1)).includes(target),
      WAIT_MS,
    );
    // Rebuilt decks exclude the pair too (SQL and filter).
    await redis.del(`discovery:deck:${v.id}`);
    await deckReady(v.id);
    expect(await redis.lrange(`discovery:deck:${v.id}`, 0, -1)).not.toContain(target);
  });

  it('refuses to block yourself or an unknown user', async () => {
    const v = viewer();
    const self = await app.http.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: { ...(await auth(v.id)), 'content-type': 'application/json' },
      payload: { targetId: v.public_id },
    });
    expect(self.json().error.code).toBe('VALIDATION_FAILED');
    const unknown = await app.http.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: { ...(await auth(v.id)), 'content-type': 'application/json' },
      payload: { targetId: 'AAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('a banned user is dropped at read time', async () => {
    const v = viewer();
    await deckReady(v.id);
    const [target] = await redis.lrange(`discovery:deck:${v.id}`, 0, 0);
    await infra.admin`INSERT INTO safety.bans (id, user_id, reason, created_by)
      VALUES (${randomUUID()}, ${target}, 'test', ${randomUUID()})`;
    expect(await app.boot.apis.get('safety').isBanned(target)).toBe(true);
    const [t] = await infra.admin`SELECT public_id FROM identity.users WHERE id = ${target}`;
    const page = await deck(v.id);
    expect(page.body.cards.map((/** @type {any} */ c) => c.userId)).not.toContain(t.public_id);
  });

  it('a refill is queued when fewer than 20 remain, and the deck comes back to full size', async () => {
    const v = viewer();
    await deckReady(v.id);
    const key = `discovery:deck:${v.id}`;
    await redis.ltrim(key, 0, 24); // 25 left; one page leaves 15
    await deck(v.id);
    await eventually(async () => (await redis.llen(key)) > 20, WAIT_MS);
  });

  it('concurrent refill requests produce one job', async () => {
    const jobs = createJobs({
      connection: app.platform.redis.bullmq,
      logger: app.platform.logger,
      prefix: `dedupe-${Date.now()}`,
    });
    try {
      const builds = createBuildQueue({ jobs });
      const userId = uuidv7();
      await Promise.all(Array.from({ length: 25 }, () => builds.enqueueBuild(userId, 'refill')));
      const counts = await jobs.queue('fast').getJobCounts('waiting', 'active', 'delayed');
      expect(counts.waiting + counts.active + counts.delayed).toBe(1);
      expect((await jobs.queue('fast').getJob(`deck-${userId}`))?.data).toEqual({
        userId,
        reason: 'refill',
      });
    } finally {
      await jobs.queue('fast').obliterate({ force: true });
      await jobs.close();
    }
  });

  it('an incomplete profile gets PROFILE_INCOMPLETE; a profile that stops being active loses its deck', async () => {
    const v = viewer();
    await deckReady(v.id);
    await infra.admin`UPDATE profiles.profiles SET status = 'pending' WHERE user_id = ${v.id}`;
    const response = await deck(v.id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROFILE_INCOMPLETE');
    // profiles emits profile.updated.v1 on a real change; simulate the event's effect.
    const consumers = app.boot.consumers.find(
      (/** @type {any} */ c) => c.module === 'discovery' && c.event === 'profile.updated.v1',
    );
    await consumers.handler({ userId: v.id, status: 'pending', changed: ['photos', 'status'] }, {});
    expect(await redis.exists(`discovery:deck:${v.id}`)).toBe(0);
  });

  it('the candidate source reads from the replica pool when one is configured', async () => {
    const [row] = await app.platform.db.read(
      'discovery',
      (/** @type {any} */ tx) => tx`SELECT current_setting('application_name') AS name`,
      { replica: true },
    );
    expect(row.name).toBe('vouch-api-replica');
    const [primary] = await app.platform.db.read(
      'discovery',
      (/** @type {any} */ tx) => tx`SELECT current_setting('application_name') AS name`,
    );
    expect(primary.name).toBe('vouch-api');
  });
});
