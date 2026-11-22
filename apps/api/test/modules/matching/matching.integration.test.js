// @ts-check
import { randomUUID } from 'node:crypto';
import {
  listMatches as listMatchesEndpoint,
  swipe as swipeEndpoint,
  unmatch as unmatchEndpoint,
} from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../../scripts/seed.js';
import modules from '../../../src/modules/index.js';
import { createPlatform, startRole } from '../../../src/platform/boot.js';
import { loadConfig } from '../../../src/platform/config.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  eventually,
  HOOK_TIMEOUT_MS,
  makeKeys,
  startInfra,
  testEnv,
} from '../../platform/helpers.js';

const H = { 'x-app-version': '1.0.0', 'content-type': 'application/json' };
const WAIT_MS = 20_000;

describe('matching (ROLE=all, the 2,000-user seed)', () => {
  /** @type {import('../../platform/helpers.js').Infra} */
  let infra;
  /** @type {any} */
  let app;
  /** @type {import('ioredis').Redis} */
  let redis;
  /** @type {import('../../platform/helpers.js').TestKeys} */
  let keys;
  /** @type {any[]} */
  let users;
  let next = 0;
  /** A fresh seeded user for each scenario. */
  const fresh = () => users[next++];

  /** @param {any} user */
  const auth = async (user) => ({
    ...H,
    authorization: `Bearer ${await keys.sign({ sub: user.id, sid: randomUUID() })}`,
  });
  /** Mark `b` as served to `a` (what a deck page does). @param {any} a @param {any} b */
  const serve = (a, b) => redis.sadd(`discovery:served:${a.id}`, b.id);
  /** @param {any} from @param {any} to @param {'like' | 'pass'} direction @param {string} [swipeId] */
  const swipe = async (from, to, direction, swipeId = randomUUID()) => {
    const response = await app.http.inject({
      method: 'POST',
      url: '/v1/swipes',
      headers: await auth(from),
      payload: { swipeId, targetId: to.public_id, direction },
    });
    return { status: response.statusCode, body: response.json(), raw: response.body };
  };
  /** @param {any} a @param {any} b */
  const swipeRows = async (a, b) =>
    infra.admin`SELECT direction FROM matching.swipes WHERE swiper_id = ${a.id} AND target_id = ${b.id}`;

  beforeAll(async () => {
    infra = await startInfra();
    keys = await makeKeys({ kid: 'active-1' });
    await seed(infra.admin);
    users = await infra.admin`SELECT u.id, u.public_id FROM identity.users u
      JOIN profiles.profiles p ON p.user_id = u.id WHERE p.status = 'active' ORDER BY u.id DESC LIMIT 60`;
    const config = loadConfig(
      testEnv({
        ROLE: 'all',
        DATABASE_URL: infra.appUrl,
        REDIS_URL: infra.redisUrl,
        JWT_SIGNING_KEYS: keys.json,
        JWT_ACTIVE_KID: keys.kid,
      }),
    );
    const platform = await createPlatform({ config, logger: createLogger({ level: 'silent' }) });
    app = await startRole({ platform, modules, listen: false });
    redis = app.platform.redis.command;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.stop(10_000);
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('end to end: a like, a like back, the match list, unmatch (idempotent, once), and no rematch', async () => {
    const [a, b] = [fresh(), fresh()];
    await serve(a, b);
    await serve(b, a);
    const first = await swipe(a, b, 'like');
    expect(swipeEndpoint.response.schema.parse(first.body)).toEqual({
      matched: false,
      matchId: null,
    });
    const back = await swipe(b, a, 'like');
    expect(back.body.matched).toBe(true);
    const matchId = back.body.matchId;
    expect(await app.boot.apis.get('matching').areMatched(a.id, b.id)).toBe(true);
    const [event] = await infra.admin`SELECT payload FROM platform.outbox
      WHERE name = 'match.created.v1' AND payload->>'matchId' = ${matchId}`;
    expect(event?.payload).toMatchObject({ firstLikerId: a.id });
    // Swiping an existing match returns it.
    expect((await swipe(a, b, 'like')).body).toEqual({ matched: true, matchId });

    const list = await app.http.inject({ url: '/v1/matches', headers: await auth(a) });
    const page = listMatchesEndpoint.response.schema.parse(list.json());
    expect(
      page.items.map((/** @type {any} */ m) => [m.matchId, m.user.userId, m.conversationId]),
    ).toEqual([[matchId, b.public_id, null]]);

    const unmatch = async () =>
      app.http.inject({
        method: 'POST',
        url: `/v1/matches/${matchId}/unmatch`,
        headers: await auth(a),
        payload: {},
      });
    const once = await unmatch();
    expect(once.statusCode).toBe(200);
    const twice = await unmatch();
    expect(unmatchEndpoint.response.schema.parse(twice.json())).toEqual(once.json());
    const unmatched = await infra.admin`SELECT payload FROM platform.outbox
      WHERE name = 'match.unmatched.v1' AND payload->>'matchId' = ${matchId}`;
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]?.payload.unmatchedBy).toBe(a.id);
    expect(
      (await app.http.inject({ url: '/v1/matches', headers: await auth(a) })).json().items,
    ).toEqual([]);
    // Unmatch is permanent: liking again never rematches.
    expect((await swipe(b, a, 'like')).body).toEqual({ matched: false, matchId: null });
    // A non-member cannot unmatch.
    const stranger = await app.http.inject({
      method: 'POST',
      url: `/v1/matches/${matchId}/unmatch`,
      headers: await auth(fresh()),
      payload: {},
    });
    expect(stranger.statusCode).toBe(404);
  });

  it('the same swipeId sent twice creates one swipe and returns the same answer', async () => {
    const [a, b] = [fresh(), fresh()];
    await serve(a, b);
    const swipeId = randomUUID();
    const one = await swipe(a, b, 'like', swipeId);
    const two = await swipe(a, b, 'like', swipeId);
    expect(two.body).toEqual(one.body);
    expect(await swipeRows(a, b)).toHaveLength(1);
  });

  it('two concurrent likes from the same user (different swipeIds) after a like back emit one match.created.v1', async () => {
    const [a, b] = [fresh(), fresh()];
    await serve(a, b);
    await serve(b, a);
    await swipe(b, a, 'like');
    const replies = await Promise.all(Array.from({ length: 5 }, () => swipe(a, b, 'like')));
    const ids = new Set(replies.map((r) => r.body.matchId));
    expect(ids.size).toBe(1);
    expect(replies.every((r) => r.body.matched)).toBe(true);
    const events = await infra.admin`SELECT 1 FROM platform.outbox
      WHERE name = 'match.created.v1' AND payload->>'matchId' = ${[...ids][0]}`;
    expect(events).toHaveLength(1);
  });

  it('refuses unserved targets, unknown users and incomplete profiles', async () => {
    const [a, b] = [fresh(), fresh()];
    const notServed = await swipe(a, b, 'like');
    expect(notServed.body.error.code).toBe('NOT_SERVED');
    const unknown = await swipe(a, { public_id: 'AAAAAAAAAAAAAAAAAAAAAA' }, 'like');
    expect(unknown.status).toBe(404);
    await infra.admin`UPDATE profiles.profiles SET status = 'pending' WHERE user_id = ${a.id}`;
    await serve(a, b);
    expect((await swipe(a, b, 'like')).body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('a blocked pair never matches, and the swipe answer is identical to a normal pass (nothing stored)', async () => {
    const [a, b, c] = [fresh(), fresh(), fresh()];
    await serve(a, b);
    await serve(b, a);
    await serve(b, c);
    expect((await swipe(a, b, 'like')).body.matched).toBe(false);
    const block = await app.http.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: await auth(a),
      payload: { targetId: b.public_id },
    });
    expect(block.statusCode).toBe(200);
    // b, who was blocked, likes a back: same status and body, byte for byte, as a plain pass.
    const blockedLike = await swipe(b, a, 'like');
    const normalPass = await swipe(b, c, 'pass');
    expect(blockedLike.status).toBe(normalPass.status);
    expect(blockedLike.raw).toBe(normalPass.raw);
    expect(await swipeRows(b, a)).toHaveLength(0);
    // The blocker's own swipe is answered the same way.
    expect((await swipe(a, b, 'pass')).raw).toBe(normalPass.raw);
    expect(await app.boot.apis.get('matching').areMatched(a.id, b.id)).toBe(false);
    expect(
      await infra.admin`SELECT 1 FROM matching.matches WHERE user_low = ${a.id < b.id ? a.id : b.id}
      AND user_high = ${a.id < b.id ? b.id : a.id}`,
    ).toHaveLength(0);
  });

  it('a block ends an existing match (consumer, unmatchedBy null)', async () => {
    const [a, b] = [fresh(), fresh()];
    await serve(a, b);
    await serve(b, a);
    await swipe(a, b, 'like');
    const { matchId } = (await swipe(b, a, 'like')).body;
    await app.http.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: await auth(b),
      payload: { targetId: a.public_id },
    });
    await eventually(
      async () => !(await app.boot.apis.get('matching').areMatched(a.id, b.id)),
      WAIT_MS,
    );
    const [event] = await infra.admin`SELECT payload FROM platform.outbox
      WHERE name = 'match.unmatched.v1' AND payload->>'matchId' = ${matchId}`;
    expect(event?.payload.unmatchedBy).toBeNull();
  });

  it('passes are buffered, excluded from a deck built before the flush, then written in a batch', async () => {
    const viewer = fresh();
    // Build the viewer's deck and take a real candidate from it.
    await app.http.inject({ url: '/v1/deck', headers: await auth(viewer) });
    await eventually(
      async () => (await redis.exists(`discovery:deck:${viewer.id}`)) === 1,
      WAIT_MS,
    );
    const [targetId] = await redis.lrange(`discovery:deck:${viewer.id}`, 0, 0);
    const [target] =
      await infra.admin`SELECT id, public_id FROM identity.users WHERE id = ${targetId}`;
    // A pass that is still only in the buffer (pending set), not yet in Postgres:
    await redis.sadd(`matching:passes:pending:${viewer.id}`, target.id);
    await redis.del(`discovery:deck:${viewer.id}`);
    await app.http.inject({ url: '/v1/deck', headers: await auth(viewer) });
    await eventually(
      async () => (await redis.exists(`discovery:deck:${viewer.id}`)) === 1,
      WAIT_MS,
    );
    expect(await redis.lrange(`discovery:deck:${viewer.id}`, 0, -1)).not.toContain(target.id);
    await redis.srem(`matching:passes:pending:${viewer.id}`, target.id);

    // A real pass: answered at once, written by the flush within about 5 s.
    await serve(viewer, target);
    expect((await swipe(viewer, target, 'pass')).body).toEqual({ matched: false, matchId: null });
    expect(await redis.sismember(`matching:passes:pending:${viewer.id}`, target.id)).toBe(1);
    await eventually(async () => (await swipeRows(viewer, target)).length === 1, WAIT_MS);
    expect((await swipeRows(viewer, target))[0]?.direction).toBe(0);
    await eventually(
      async () => (await redis.sismember(`matching:passes:pending:${viewer.id}`, target.id)) === 0,
      WAIT_MS,
    );
  });

  it('retention deletes only passes older than 30 days, in every partition; likes stay', async () => {
    const swipers = users.slice(40, 52);
    const target = users[59];
    for (const [i, s] of swipers.entries()) {
      const old = i % 3 !== 0;
      await infra.admin`INSERT INTO matching.swipes (swiper_id, target_id, direction, created_at)
        VALUES (${s.id}, ${target.id}, ${i % 4 === 0 ? 1 : 0},
          now() - ${old ? '31 days' : '29 days'}::interval)`;
    }
    const expected = swipers.filter((_, i) => !(i % 3 !== 0 && i % 4 !== 0)).length;
    const tick = app.boot.jobs.find((/** @type {any} */ j) => j.name === 'matching.retentionTick');
    expect(await tick.handler({ data: {} })).toEqual({ queued: 16 });
    await eventually(async () => {
      const rows = await infra.admin`SELECT 1 FROM matching.swipes WHERE target_id = ${target.id}`;
      return rows.length === expected;
    }, WAIT_MS);
    const left = await infra.admin`SELECT direction, created_at < now() - interval '30 days' AS old
      FROM matching.swipes WHERE target_id = ${target.id}`;
    expect(left.every((r) => r.direction === 1 || !r.old)).toBe(true);
  });

  it('likesIn counts unanswered likes only, and exports list swipes and matches by public id', async () => {
    const [me, x, y] = [fresh(), fresh(), fresh()];
    for (const liker of [x, y]) {
      await serve(liker, me);
      await swipe(liker, me, 'like');
    }
    const api = app.boot.apis.get('matching');
    expect(await api.likesIn(me.id)).toBe(2);
    await serve(me, x);
    await swipe(me, x, 'like'); // answered: now a match
    expect(await api.likesIn(me.id)).toBe(1);
    const exported = (
      await app.http.inject({ url: '/v1/me/export', headers: await auth(me) })
    ).json();
    expect(exported.data.matching.swipes).toEqual([
      expect.objectContaining({ userId: x.public_id, direction: 'like' }),
    ]);
    expect(exported.data.matching.matches).toEqual([
      expect.objectContaining({ userId: x.public_id, unmatchedAt: null }),
    ]);
  });

  it('account deletion removes the swipes and anonymises the match', async () => {
    const [a, b] = [fresh(), fresh()];
    await serve(a, b);
    await serve(b, a);
    await swipe(a, b, 'like');
    const { matchId } = (await swipe(b, a, 'like')).body;
    const removed = await app.http.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: (({ 'content-type': _json, ...rest }) => ({
        ...rest,
        'idempotency-key': `del-${randomUUID()}`,
      }))(await auth(a)),
    });
    expect(removed.statusCode).toBe(202);
    await eventually(async () => {
      const [m] = await infra.admin`SELECT user_low, user_high, anonymised_at, unmatched_at
        FROM matching.matches WHERE id = ${matchId}`;
      return m?.anonymised_at ? m : null;
    }, WAIT_MS);
    const [m] =
      await infra.admin`SELECT user_low, user_high, unmatched_at FROM matching.matches WHERE id = ${matchId}`;
    expect([m.user_low, m.user_high]).toContain(b.id);
    expect([m.user_low, m.user_high]).not.toContain(a.id);
    expect(m.user_low < m.user_high).toBe(true);
    expect(m.unmatched_at).not.toBeNull();
    expect(
      await infra.admin`SELECT 1 FROM matching.swipes WHERE swiper_id = ${a.id} OR target_id = ${a.id}`,
    ).toHaveLength(0);
  });
});
