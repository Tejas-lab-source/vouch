// @ts-check
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { startChatStack } from '../modules/chat/harness.js';

const PAIRS = 250; // 500 sockets
const PER_SOCKET = 50;
// Each socket sends about one message a second (a fast typist), so the test measures delivery
// latency rather than a queue built by 500 clients sending back to back.
const INTERVAL_MS = 1000;
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {number[]} sorted @param {number} p */
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;

/** A gateway's resident memory in MB, from its Prometheus metrics. @param {string} metricsUrl */
async function rssMb(metricsUrl) {
  const text = await (await fetch(metricsUrl)).text();
  const bytes = Number(/^process_resident_memory_bytes (\d+)/m.exec(text)?.[1] ?? 0);
  return Math.round(bytes / 1024 / 1024);
}

describe('load smoke: 500 sockets on two gateway processes, 50 messages each', () => {
  /** @type {Awaited<ReturnType<typeof startChatStack>>} */
  let stack;

  beforeAll(async () => {
    stack = await startChatStack();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await stack?.stop();
  }, HOOK_TIMEOUT_MS);

  it('zero loss, no duplicates, delivery p95 under 1 s at about 500 messages a second', async () => {
    const [a, b] = await Promise.all([stack.spawnGateway(), stack.spawnGateway()]);
    const idle = { a: await rssMb(a.metricsUrl), b: await rssMb(b.metricsUrl) };

    /** @type {Awaited<ReturnType<typeof stack.matchedPair>>[]} */
    const pairs = [];
    for (let i = 0; i < PAIRS; i += 25) {
      pairs.push(...(await Promise.all(Array.from({ length: 25 }, () => stack.matchedPair()))));
    }

    /** @type {Map<string, number>} clientMsgId → send time */
    const sentAt = new Map();
    /** @type {number[]} */
    const latencies = [];
    let duplicates = 0;

    /** Each member: one socket, the members of a pair on different gateways. */
    const members = (
      await Promise.all(
        pairs.flatMap(({ a: x, b: y, conversationId }) =>
          [
            { user: x, url: a.url },
            { user: y, url: b.url },
          ].map(async ({ user, url }) => {
            const socket = /** @type {any} */ (await stack.socketAt(url, await stack.token(user)));
            /** @type {Set<string>} */
            const mine = new Set();
            /** @type {Set<string>} */
            const fromPartner = new Set();
            socket.on('message.new', (/** @type {any} */ m) => {
              if (mine.has(m.clientMsgId)) return;
              if (fromPartner.has(m.clientMsgId)) duplicates += 1;
              fromPartner.add(m.clientMsgId);
              latencies.push(performance.now() - (sentAt.get(m.clientMsgId) ?? 0));
            });
            return { socket, conversationId, mine, fromPartner };
          }),
        ),
      )
    ).flat();
    expect(members.length).toBe(PAIRS * 2);

    let acked = 0;
    const started = performance.now();
    await Promise.all(
      members.map(async ({ socket, conversationId, mine }) => {
        await sleep(Math.random() * INTERVAL_MS);
        for (let i = 0; i < PER_SOCKET; i += 1) {
          const tick = performance.now();
          const clientMsgId = randomUUID();
          mine.add(clientMsgId);
          sentAt.set(clientMsgId, performance.now());
          const ack = await socket.timeout(10_000).emitWithAck('message.send', {
            conversationId,
            clientMsgId,
            kind: 'text',
            body: `m${i}`,
          });
          if (ack.ok) acked += 1;
          await sleep(Math.max(0, INTERVAL_MS - (performance.now() - tick)));
        }
      }),
    );
    const total = PAIRS * 2 * PER_SOCKET;
    await eventually(() => latencies.length >= total, 30_000).catch(() => {});
    const elapsed = performance.now() - started;
    const loaded = { a: await rssMb(a.metricsUrl), b: await rssMb(b.metricsUrl) };
    const sorted = [...latencies].sort((x, y) => x - y);
    const lost = members.reduce((n, m) => n + (PER_SOCKET - m.fromPartner.size), 0);
    const report = {
      sockets: members.length,
      messages: total,
      acked,
      delivered: latencies.length,
      lost,
      duplicates,
      p50Ms: Math.round(percentile(sorted, 0.5)),
      p95Ms: Math.round(percentile(sorted, 0.95)),
      throughputPerSec: Math.round(total / (elapsed / 1000)),
      gatewayRssMb: { idle, with250SocketsEach: loaded },
    };
    process.stdout.write(`PHASE9_LOAD ${JSON.stringify(report)}\n`);

    for (const { socket } of members) socket.disconnect();
    expect(acked).toBe(total);
    expect(lost).toBe(0);
    expect(duplicates).toBe(0);
    expect(report.p95Ms).toBeLessThan(1000);
  }, 300_000);
});
