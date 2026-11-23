// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_DATA } from '../../src/platform/jobs/consistency.js';
import { eventually, HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { startBackend, WAIT_MS } from '../modules/phase10/harness.js';

/**
 * Phase 14 invariant: account deletion erases the user from every table that holds user data
 * (`USER_DATA`, kept complete by test/db/user-data.test.js). The other person keeps the closed
 * conversation and their own messages, with the deleted member replaced by a tombstone.
 */
describe('invariant: deletion erases everywhere', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;
  beforeAll(async () => {
    b = await startBackend();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  it('a user with data in every module leaves no row behind', async () => {
    const [x, y, z] = [await b.signUp(), await b.signUp(), await b.signUp()];
    const matchId = await b.match(x, y);
    const [sx, sy] = [await b.socket(x.token), await b.socket(y.token)];
    for (const [socket, body] of [
      [sx, 'from x'],
      [sy, 'from y'],
    ]) {
      const ack = await /** @type {any} */ (socket).emitWithAck('message.send', {
        conversationId: matchId,
        clientMsgId: randomUUID(),
        kind: 'text',
        body,
      });
      expect(ack.ok).toBe(true);
    }
    sx.disconnect();
    sy.disconnect();
    await b.registerPush(x.token, `ExponentPushToken[x-${randomUUID()}]`);
    await b.call('PUT', '/v1/me/chat-settings', {
      token: x.token,
      body: { shareReadReceipts: true },
    });
    await b.call('PUT', '/v1/me/profile/sections/basics', {
      token: x.token,
      body: { values: {} },
    });
    await b.call('POST', '/v1/blocks', { token: x.token, body: { targetId: z.publicId } });
    await b.call('POST', '/v1/blocks', { token: z.token, body: { targetId: x.publicId } });

    const deleted = await b.call('DELETE', '/v1/me', { token: x.token });
    expect(deleted.status).toBe(202);
    const consumers = b.app.boot.subscriptions.get('user.deleted.v1') ?? [];
    await eventually(async () => {
      const rows = await b.infra.admin`SELECT module FROM platform.deletion_tasks
        WHERE user_id = ${x.id} AND completed_at IS NOT NULL`;
      return rows.length === consumers.length || null;
    }, WAIT_MS);

    /** @type {string[]} */
    const left = [];
    for (const [table, column] of USER_DATA) {
      const [{ n }] = await b.infra.admin.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
        [x.id],
      );
      if (n > 0) left.push(`${table}.${column}: ${n}`);
    }
    expect(left).toEqual([]);

    // The other person keeps the closed conversation and their own message only.
    const [conversation] = await b.infra.admin`SELECT user_low, user_high, closed_at
      FROM chat.conversations WHERE id = ${matchId}`;
    expect(conversation.closed_at).not.toBeNull();
    expect([conversation.user_low, conversation.user_high]).toContain(y.id);
    const bodies = await b.infra.admin`SELECT body FROM chat.messages
      WHERE conversation_id = ${matchId}`;
    expect(bodies.map((r) => r.body)).toEqual(['from y']);
  }, 300_000);
});
