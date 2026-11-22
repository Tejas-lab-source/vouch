// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, HOOK_TIMEOUT_MS } from '../../platform/helpers.js';
import { startBackend, WAIT_MS } from './harness.js';

/** @param {number[]} sorted @param {number} p */
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;

describe(
  'notifications: pushes, preferences, quiet hours, batching (Phase 10)',
  { timeout: 120_000 },
  () => {
    /** @type {Awaited<ReturnType<typeof startBackend>>} */
    let b;

    beforeAll(async () => {
      b = await startBackend();
    }, HOOK_TIMEOUT_MS);
    afterAll(async () => {
      await b?.stop();
    }, HOOK_TIMEOUT_MS);

    /** Pushes to one device token. @param {string} token */
    const pushesTo = (token) => b.pushes.filter((p) => p.token === token);
    /** @param {string} userId */
    const deliveries = (userId) =>
      b.infra.admin`SELECT template, status, error_code FROM notifications.deliveries
      WHERE user_id = ${userId} ORDER BY created_at, id`;

    /** Two matched users, each with a push token; A liked first. */
    async function pair() {
      const [a, c] = [await b.signUp(), await b.signUp()];
      const [ta, tc] = [
        `ExponentPushToken[a-${randomUUID()}]`,
        `ExponentPushToken[c-${randomUUID()}]`,
      ];
      await b.registerPush(a.token, ta);
      await b.registerPush(c.token, tc);
      const conversationId = await b.match(a, c);
      return { a, c, ta, tc, conversationId };
    }

    /** @param {any} socket @param {string} conversationId @param {string} body */
    const send = (socket, conversationId, body) =>
      socket.emitWithAck('message.send', {
        conversationId,
        clientMsgId: randomUUID(),
        kind: 'text',
        body,
      });

    it('a match sends exactly one push, to the user who liked first; it carries no name or body', async () => {
      const { a, ta, tc, conversationId } = await pair();
      await eventually(() => pushesTo(ta).length === 1 || null, WAIT_MS);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(pushesTo(ta)).toHaveLength(1);
      expect(pushesTo(tc)).toHaveLength(0);
      expect(pushesTo(ta)[0]).toMatchObject({
        title: 'It’s a match',
        data: { type: 'match.new', matchId: conversationId },
      });
      expect(JSON.stringify(pushesTo(ta))).not.toContain('Asha');
      expect(await deliveries(a.id)).toEqual([
        { template: 'match.new', status: 'sent', error_code: null },
      ]);
    });

    it('a message to an offline user sends one push without the body; 5 quick messages collapse into 1', async () => {
      const { c, tc, a, conversationId } = await pair();
      const sa = await b.socket(a.token);
      const before = pushesTo(tc).length;
      for (let i = 0; i < 5; i += 1) {
        expect((await send(sa, conversationId, `secret body ${i}`)).ok).toBe(true);
      }
      await eventually(async () => {
        const rows = await deliveries(c.id);
        return rows.filter((r) => r.template === 'message.new').length === 5 || null;
      }, WAIT_MS);
      await eventually(() => pushesTo(tc).length === before + 1 || null, WAIT_MS);
      const pushed = pushesTo(tc).at(-1);
      expect(pushed).toMatchObject({
        title: 'New message',
        data: { type: 'message.new', conversationId },
      });
      expect(JSON.stringify(b.pushes)).not.toContain('secret body');
      const messageRows = (await deliveries(c.id)).filter((r) => r.template === 'message.new');
      expect(messageRows.map((r) => r.status).sort()).toEqual([
        'sent',
        'suppressed',
        'suppressed',
        'suppressed',
        'suppressed',
      ]);
      expect(
        messageRows
          .filter((r) => r.status === 'suppressed')
          .every((r) => r.error_code === 'batched'),
      ).toBe(true);
      sa.disconnect();
    });

    it('a recipient who is online gets no push', async () => {
      const { a, c, tc, conversationId } = await pair();
      const [sa, sc] = [await b.socket(a.token), await b.socket(c.token)];
      const before = pushesTo(tc).length;
      expect((await send(sa, conversationId, 'hi')).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(pushesTo(tc).length).toBe(before);
      sa.disconnect();
      sc.disconnect();
    });

    it('quiet hours and a switched-off preference suppress the push (and say why)', async () => {
      const { a, c, tc, conversationId } = await pair();
      // Quiet all day except a zero-length window, in the user's time zone: always quiet.
      const prefs = await b.call('PUT', '/v1/me/notification-prefs', {
        token: c.token,
        body: {
          pushMatches: true,
          pushMessages: true,
          pushLikesDigest: true,
          quietHours: { startMinute: 0, endMinute: 1439 },
          timezone: 'Asia/Kolkata',
        },
      });
      expect(prefs.status).toBe(200);
      const sa = await b.socket(a.token);
      const before = pushesTo(tc).length;
      await send(sa, conversationId, 'late night');
      const rows = await eventually(async () => {
        const r = (await deliveries(c.id)).filter((d) => d.template === 'message.new');
        return r.length === 1 ? r : null;
      }, WAIT_MS);
      expect(rows[0]).toMatchObject({
        status: 'suppressed',
        error_code: expect.stringMatching(/quiet_hours|preference/),
      });
      expect(pushesTo(tc).length).toBe(before);
      const bad = await b.call('PUT', '/v1/me/notification-prefs', {
        token: c.token,
        body: {
          pushMatches: true,
          pushMessages: true,
          pushLikesDigest: true,
          quietHours: null,
          timezone: 'Mars/Base',
        },
      });
      expect(bad.status).toBe(400);
      sa.disconnect();
    });

    it('an invalid token (DeviceNotRegistered) is removed from the device', async () => {
      const [a, c] = [await b.signUp(), await b.signUp()];
      const dead = `ExponentPushToken[dead-${randomUUID()}]`;
      b.invalidTokens.add(dead);
      await b.registerPush(a.token, dead);
      await b.match(a, c);
      await eventually(async () => {
        const rows = await b.infra
          .admin`SELECT push_token FROM identity.devices WHERE user_id = ${a.id}`;
        return rows.every((r) => r.push_token === null) || null;
      }, WAIT_MS);
      // The token is removed before the delivery is recorded: wait for the final status too.
      const row = await eventually(async () => {
        const [first] = await deliveries(a.id);
        return first && first.status !== 'queued' ? first : null;
      }, WAIT_MS);
      expect(row).toMatchObject({
        template: 'match.new',
        status: 'failed',
        error_code: 'DeviceNotRegistered',
      });
    });

    it('a block cancels pushes still queued between the pair', async () => {
      const { a, c, tc, conversationId } = await pair();
      const sa = await b.socket(a.token);
      const before = pushesTo(tc).length;
      // Stop the external queue so the push job waits, block, then let it run.
      const queue = b.app.platform.jobs.queue('external');
      await queue.pause();
      await send(sa, conversationId, 'one');
      await eventually(
        async () => (await deliveries(c.id)).some((d) => d.template === 'message.new') || null,
        WAIT_MS,
      );
      await b.call('POST', '/v1/blocks', { token: c.token, body: { targetId: a.publicId } });
      await eventually(async () => {
        const keys = await b.app.platform.redis.command.keys('notifications:cancel:*');
        return keys.length > 0 || null;
      }, WAIT_MS);
      await queue.resume();
      const row = await eventually(async () => {
        const r = (await deliveries(c.id)).find((d) => d.template === 'message.new');
        return r && r.status !== 'queued' ? r : null;
      }, WAIT_MS);
      expect(row).toMatchObject({ status: 'cancelled', error_code: 'blocked' });
      expect(pushesTo(tc).length).toBe(before);
      sa.disconnect();
    });

    it('notification timing: message sent → push handed to the provider, p95 under 2 s locally', async () => {
      /** @type {number[]} */
      const ms = [];
      for (let i = 0; i < 20; i += 1) {
        const { a, tc, conversationId } = await pair();
        const sa = await b.socket(a.token);
        const before = pushesTo(tc).length;
        const started = performance.now();
        await send(sa, conversationId, 'timed');
        const pushed = await eventually(
          () => (pushesTo(tc).length > before ? pushesTo(tc).at(-1) : null),
          WAIT_MS,
        );
        ms.push(/** @type {any} */ (pushed).at - started);
        sa.disconnect();
      }
      const sorted = [...ms].sort((x, y) => x - y);
      const report = {
        samples: ms.length,
        p50Ms: Math.round(percentile(sorted, 0.5)),
        p95Ms: Math.round(percentile(sorted, 0.95)),
      };
      process.stdout.write(`PHASE10_PUSH_TIMING ${JSON.stringify(report)}\n`);
      expect(report.p95Ms).toBeLessThan(2000);
    }, 300_000);
  },
);
