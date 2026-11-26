// @ts-check
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { startChatStack } from '../modules/chat/harness.js';

const PAIRS = 40;
const KILL_AFTER = 8;
const MESSAGES = 60;

/**
 * Phase 14 invariant: the worker (outbox relay and every consumer) is killed with SIGKILL in
 * the middle of a burst. Nothing acknowledged is lost, and every event is processed exactly
 * once per consumer after a new worker takes over.
 */
describe('invariant: a worker dies mid-burst; no event is lost and each is processed once per consumer', () => {
  /** @type {Awaited<ReturnType<typeof startChatStack>>} */
  let stack;

  beforeAll(async () => {
    // The in-process runtime serves REST only: events are processed only by spawned workers.
    stack = await startChatStack({ RATE_LIMIT_MESSAGES_MINUTE: '100000' }, { appRole: 'api' });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await stack?.stop();
  }, HOOK_TIMEOUT_MS);

  it(`${PAIRS} matches and ${MESSAGES} messages; the worker is killed after ${KILL_AFTER} conversations`, async () => {
    const sql = stack.infra.admin;
    const first = await stack.spawnGateway({ ROLE: 'worker' });

    // One conversation for the message stream, created while the first worker runs.
    const [x, y] = [stack.fresh(), stack.fresh()];
    const streamId = await stack.swipeMatch(x, y);
    await eventually(
      async () => (await sql`SELECT 1 FROM chat.conversations WHERE id = ${streamId}`).length,
      60_000,
    );
    const sender = /** @type {any} */ (await stack.socketFor(stack.gatewayA, x));

    // The burst: PAIRS matches (match.created.v1 for chat, notifications and discovery).
    const pairs = Array.from({ length: PAIRS }, () => [stack.fresh(), stack.fresh()]);
    const matching = Promise.all(pairs.map(([a, b]) => stack.swipeMatch(a, b)));

    /** @type {Map<string, number>} */
    const acked = new Map();
    let killed = false;
    for (let i = 0; i < MESSAGES; i += 1) {
      if (!killed) {
        const [{ n }] =
          await sql`SELECT count(*)::int AS n FROM chat.conversations WHERE id <> ${streamId}`;
        if (n >= KILL_AFTER) {
          killed = true;
          first.child.kill('SIGKILL');
          await stack.spawnGateway({ ROLE: 'worker' });
        }
      }
      const clientMsgId = randomUUID();
      const ack = await new Promise((resolve) =>
        sender.emit(
          'message.send',
          { conversationId: streamId, clientMsgId, kind: 'text', body: `m ${i}` },
          resolve,
        ),
      );
      if (/** @type {any} */ (ack)?.ok) acked.set(clientMsgId, /** @type {any} */ (ack).seq);
    }
    const matchIds = await matching;
    if (!killed) {
      first.child.kill('SIGKILL');
      await stack.spawnGateway({ ROLE: 'worker' });
      killed = true;
    }
    sender.disconnect();

    // Every match gets its conversation, created by the surviving worker where needed. A job
    // the killed worker held waits for BullMQ's stalled-job check (30 s lock + 30 s interval),
    // so this allows the same 120 s as the recovery wait below (CI timed out once at 90 s).
    await eventually(async () => {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat.conversations
        WHERE id = ANY(${matchIds})`;
      return n === PAIRS;
    }, 120_000);
    // Every event is published, and each consumer processed each event exactly once.
    await eventually(async () => {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM platform.outbox
        WHERE published_at IS NULL`;
      return n === 0;
    }, 90_000);
    const events = await sql`SELECT id FROM platform.outbox
      WHERE name = 'match.created.v1' AND payload->>'matchId' = ANY(${matchIds})`;
    const ids = events.map((e) => e.id);
    const perConsumer = () => sql`SELECT consumer, count(*)::int AS n FROM platform.inbox
      WHERE event_id = ANY(${ids}) GROUP BY consumer ORDER BY consumer`;
    // A job the killed worker held is redelivered once its queue lock expires (BullMQ stalled
    // jobs, 30 s): its inbox row comes then. Handlers are idempotent, so the redelivery is safe.
    const recoveryStarted = performance.now();
    const processed = await eventually(async () => {
      const rows = await perConsumer();
      return rows.length >= 3 && rows.every((r) => r.n === PAIRS) ? rows : null;
    }, 120_000);
    const recoveryMs = Math.round(performance.now() - recoveryStarted);
    const stored = await sql`SELECT client_msg_id FROM chat.messages
      WHERE conversation_id = ${streamId}`;

    const report = {
      matches: PAIRS,
      events: events.length,
      perConsumer: Object.fromEntries(processed.map((r) => [r.consumer, r.n])),
      acked: acked.size,
      recoveryMs,
      ackedStored: [...acked.keys()].filter((id) => stored.some((s) => s.client_msg_id === id))
        .length,
    };
    const out = process.env.INVARIANT_REPORT;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path the runner chose
    if (out) appendFileSync(out, `worker-kill ${JSON.stringify(report)}\n`);
    expect(killed).toBe(true);
    expect(report.events).toBe(PAIRS);
    expect(processed.length).toBeGreaterThan(0);
    for (const row of processed) expect([row.consumer, row.n]).toEqual([row.consumer, PAIRS]);
    expect(report.acked).toBe(MESSAGES);
    expect(report.ackedStored).toBe(MESSAGES);
  }, 400_000);
});
