// @ts-check
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELAY_IDLE_INTERVAL_MS } from '../../src/platform/events/relay.js';
import { eventually, HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { collect, startBackend } from '../modules/phase10/harness.js';

/** One consumer cycle: the relay's idle poll plus processing. */
const CYCLE_MS = RELAY_IDLE_INTERVAL_MS + 1000;

/**
 * Phase 14 invariant: a block hides both users from each other everywhere within one consumer
 * cycle: matches, conversations, sending, the deck, and each other's profile in reports.
 */
describe('invariant: a block hides both users everywhere within one consumer cycle', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;
  beforeAll(async () => {
    b = await startBackend();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  it('blocker and blocked lose each other in every view', async () => {
    const [a, c] = [await b.signUp(), await b.signUp()];
    const matchId = await b.match(a, c);
    const [sa, sc] = [await b.socket(a.token), await b.socket(c.token)];
    const closedForC = collect(sc, 'conversation.closed');

    const started = performance.now();
    const blocked = await b.call('POST', '/v1/blocks', {
      token: a.token,
      body: { targetId: c.publicId },
    });
    expect(blocked.status).toBe(200);

    /** Whether `who` still has `other` in matches or an open conversation. @param {any} who @param {any} other */
    const sees = async (who, other) => {
      const [matches, conversations] = await Promise.all([
        b.call('GET', '/v1/matches', { token: who.token }),
        b.call('GET', '/v1/conversations', { token: who.token }),
      ]);
      const inMatches = matches.body.items.some(
        (/** @type {any} */ m) => m.user.userId === other.publicId,
      );
      const openChat = conversations.body.items.some(
        (/** @type {any} */ x) => x.user.userId === other.publicId && !x.closed,
      );
      return inMatches || openChat;
    };
    await eventually(
      async () => !(await sees(a, c)) && !(await sees(c, a)) && closedForC.length > 0,
      CYCLE_MS * 3,
    );
    const hiddenMs = Math.round(performance.now() - started);
    // Neither appears in the other's deck (the deck is rate-limited, so checked once).
    for (const [who, other] of [
      [a, c],
      [c, a],
    ]) {
      const deck = await b.call('GET', '/v1/deck', { token: who.token });
      expect(deck.status).toBe(200);
      expect(deck.body.cards.map((/** @type {any} */ x) => x.userId)).not.toContain(other.publicId);
    }

    // Sending is refused both ways, at once.
    for (const [socket, label] of [
      [sa, 'blocker'],
      [sc, 'blocked'],
    ]) {
      const ack = await /** @type {any} */ (socket).emitWithAck('message.send', {
        conversationId: matchId,
        clientMsgId: randomUUID(),
        kind: 'text',
        body: 'hello?',
      });
      expect([label, ack.ok]).toEqual([label, false]);
      expect(ack.error.code).toMatch(/CONVERSATION_CLOSED|BLOCKED/);
    }
    // The blocked user is told only that the conversation closed, never that they were blocked.
    expect(JSON.stringify(closedForC)).not.toContain('blocked');

    const out = process.env.INVARIANT_REPORT;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path the runner chose
    if (out) appendFileSync(out, `block-hides ${JSON.stringify({ hiddenMs })}\n`);
    expect(hiddenMs).toBeLessThan(CYCLE_MS);
    sa.disconnect();
    sc.disconnect();
  }, 120_000);
});
