// @ts-check
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_TIMEOUT_MS } from '../platform/helpers.js';
import { startChatStack } from '../modules/chat/harness.js';

/**
 * Phase 14: gateway memory per idle socket. One gateway in its own process (so the clients'
 * memory is not counted), 600 idle sockets (the expected beta peak), measured from the
 * gateway's own metrics after the heap settles. Target: under 100 KB per idle socket.
 */
const SOCKETS = 600;
const TARGET_KB = 100;
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} metricsUrl */
async function memory(metricsUrl) {
  const text = await (await fetch(metricsUrl)).text();
  /** @type {Map<string, number>} */
  const values = new Map();
  for (const line of text.split('\n')) {
    const [name, value] = line.split(' ');
    if (name && value && !name.startsWith('#')) values.set(name, Number(value));
  }
  /** @param {string} name */
  const metric = (name) => values.get(name) ?? Number.NaN;
  return {
    rss: metric('process_resident_memory_bytes'),
    heap: metric('nodejs_heap_size_used_bytes'),
    external: metric('nodejs_external_memory_bytes'),
  };
}

/** The settled memory: the lowest of several samples, a second apart (after GCs). */
async function settled(/** @type {string} */ metricsUrl) {
  /** @type {Awaited<ReturnType<typeof memory>>[]} */
  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    await sleep(1000);
    samples.push(await memory(metricsUrl));
  }
  return {
    rss: Math.min(...samples.map((s) => s.rss)),
    heap: Math.min(...samples.map((s) => s.heap)),
    external: Math.min(...samples.map((s) => s.external)),
  };
}

describe('gateway memory per idle socket (Phase 14)', () => {
  /** @type {Awaited<ReturnType<typeof startChatStack>>} */
  let stack;

  beforeAll(async () => {
    stack = await startChatStack();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await stack?.stop();
  }, HOOK_TIMEOUT_MS);

  it(`holds ${SOCKETS} idle sockets at under ${TARGET_KB} KB each`, async () => {
    const gateway = await stack.spawnGateway();
    const users = Array.from({ length: SOCKETS }, () => stack.fresh());
    const tokens = await Promise.all(users.map((u) => stack.token(u)));

    // Warm up: load every code path once, so the baseline is not the cost of loading code.
    const warm = await Promise.all(tokens.slice(0, 20).map((t) => stack.socketAt(gateway.url, t)));
    for (const s of warm) /** @type {any} */ (s).disconnect();
    const before = await settled(gateway.metricsUrl);

    /** @type {any[]} */
    const sockets = [];
    for (let i = 0; i < SOCKETS; i += 50) {
      sockets.push(
        ...(await Promise.all(tokens.slice(i, i + 50).map((t) => stack.socketAt(gateway.url, t)))),
      );
    }
    const held = await settled(gateway.metricsUrl);
    for (const s of sockets) s.disconnect();

    const kb = (/** @type {number} */ grown) => Math.round(grown / SOCKETS / 1024);
    const report = {
      sockets: SOCKETS,
      baselineRssMb: Math.round(before.rss / 1024 / 1024),
      heldRssMb: Math.round(held.rss / 1024 / 1024),
      rssKbPerSocket: kb(held.rss - before.rss),
      heapKbPerSocket: kb(held.heap - before.heap),
      externalKbPerSocket: kb(held.external - before.external),
    };
    // The numbers go to the Phase 14 report: written out when SOCKET_MEMORY_OUT is set.
    const out = process.env.SOCKET_MEMORY_OUT;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path the runner chose
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    expect(report.rssKbPerSocket).toBeLessThan(TARGET_KB);
  }, 300_000);
});
