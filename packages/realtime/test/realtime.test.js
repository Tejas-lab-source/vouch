// @ts-check
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealtime, memoryCursors, queryCacheAdapter } from '../src/index.js';

/**
 * A small gateway like the real one: stores messages once per clientMsgId with a gapless seq,
 * answers `sync` from cursors, and accepts `auth.refresh`.
 */
async function startGateway() {
  const http = createServer();
  const io = new Server(http, { transports: ['websocket'] });
  /** @type {any[]} */
  const stored = [];
  /** @type {any[]} */
  const tokens = [];
  /** @type {any[]} */
  const refreshes = [];
  let dropNextAck = false;
  io.use((socket, next) => {
    tokens.push(socket.handshake.auth.token);
    if (socket.handshake.auth.token === 'expired') {
      return next(
        Object.assign(new Error('UNAUTHENTICATED'), { data: { code: 'UNAUTHENTICATED' } }),
      );
    }
    return next();
  });
  io.on('connection', (socket) => {
    socket.on('message.send', (payload, ack) => {
      let message = stored.find((m) => m.clientMsgId === payload.clientMsgId);
      if (!message) {
        message = {
          ...payload,
          seq: stored.length + 1,
          senderId: 'me',
          createdAt: new Date().toISOString(),
        };
        stored.push(message);
      }
      if (dropNextAck) {
        dropNextAck = false;
        socket.disconnect(true); // the ack is lost
        return;
      }
      ack({
        ok: true,
        clientMsgId: message.clientMsgId,
        seq: message.seq,
        createdAt: message.createdAt,
      });
    });
    socket.on('sync', ({ cursors }, ack) => {
      const messages = cursors.flatMap((/** @type {any} */ c) =>
        stored.filter((m) => m.conversationId === c.conversationId && m.seq > c.lastSeq),
      );
      ack({ ok: true, messages, truncated: false });
    });
    socket.on('auth.refresh', ({ token }, ack) => {
      refreshes.push(token);
      ack({ ok: true, expiresAt: new Date(Date.now() + 900_000).toISOString() });
    });
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', () => resolve(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (http.address());
  return {
    url: `http://127.0.0.1:${port}`,
    io,
    stored,
    tokens,
    refreshes,
    dropNextAck: () => void (dropNextAck = true),
    /** A message written by "the other person" while we may be offline. */
    push: (/** @type {string} */ conversationId, /** @type {string} */ body) => {
      const message = {
        conversationId,
        clientMsgId: `other-${stored.length}`,
        kind: 'text',
        body,
        seq: stored.length + 1,
        senderId: 'other',
        createdAt: new Date().toISOString(),
      };
      stored.push(message);
      io.emit('message.new', message);
      return message;
    },
    close: () => new Promise((resolve) => io.close(() => resolve(undefined))),
  };
}

/** @param {() => boolean} fn */
const until = async (fn, ms = 5000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

/** @param {Awaited<ReturnType<typeof startGateway>>} gateway @param {Partial<Parameters<typeof createRealtime>[0]>} [extra] */
function client(gateway, extra = {}) {
  /** @type {any[]} */
  const received = [];
  /** @type {any[]} */
  const statuses = [];
  const rt = createRealtime({
    url: gateway.url,
    connect,
    session: { accessToken: () => 'tok', expiresAt: () => null, refresh: async () => 'tok' },
    onMessage: (m) => received.push(m),
    onStatus: (s) => statuses.push(s),
    ...extra,
  });
  cleanups.push(async () => rt.stop());
  return { rt, received, statuses };
}

describe('realtime client', () => {
  it('after a disconnect it reconnects and syncs the missed messages, each delivered once', async () => {
    const gateway = await startGateway();
    cleanups.push(gateway.close);
    const cursors = memoryCursors();
    const { rt, received } = client(gateway, { cursors });
    rt.start();
    await until(() => rt.socket.connected);
    gateway.push('c1', 'one');
    await until(() => received.length === 1);
    // The server drops every socket; messages arrive while we are away.
    gateway.io.disconnectSockets(true);
    await until(() => !rt.socket.connected);
    gateway.push('c1', 'two');
    gateway.push('c1', 'three');
    await until(() => received.length === 3, 10_000);
    expect(received.map((m) => m.body)).toEqual(['one', 'two', 'three']);
    expect(cursors.all()).toEqual([{ conversationId: 'c1', lastSeq: 3 }]);
  }, 20_000);

  it('a send whose ack is lost is retried with the same clientMsgId and stored once', async () => {
    const gateway = await startGateway();
    cleanups.push(gateway.close);
    const { rt } = client(gateway);
    rt.start();
    await until(() => rt.socket.connected);
    gateway.dropNextAck();
    const ack = await rt.send({ conversationId: 'c1', body: 'hello', clientMsgId: 'fixed-id' });
    expect(ack).toMatchObject({ ok: true, clientMsgId: 'fixed-id', seq: 1 });
    expect(gateway.stored.filter((m) => m.clientMsgId === 'fixed-id')).toHaveLength(1);
    expect(rt.pending()).toEqual([]);
  }, 20_000);

  it('messages sent while offline are queued and flushed on connect', async () => {
    const gateway = await startGateway();
    cleanups.push(gateway.close);
    const { rt } = client(gateway);
    const sent = rt.send({ conversationId: 'c2', body: 'queued' });
    expect(rt.pending()).toHaveLength(1);
    rt.start();
    await expect(sent).resolves.toMatchObject({ ok: true, seq: 1 });
  });

  it('refreshes the token a minute before expiry and sends auth.refresh', async () => {
    const gateway = await startGateway();
    cleanups.push(gateway.close);
    const refresh = vi.fn(async () => 'fresh-token');
    const { rt } = client(gateway, {
      session: { accessToken: () => 'tok', expiresAt: () => Date.now() + 60_050, refresh },
    });
    rt.start();
    await until(() => gateway.refreshes.length === 1, 5000);
    expect(refresh).toHaveBeenCalled();
    expect(gateway.refreshes).toEqual(['fresh-token']);
  });

  it('a stale handshake token is refreshed and the reconnect uses the new one', async () => {
    const gateway = await startGateway();
    cleanups.push(gateway.close);
    let token = 'expired';
    const { rt } = client(gateway, {
      session: {
        accessToken: () => token,
        expiresAt: () => null,
        refresh: async () => (token = 'good'),
      },
    });
    rt.start();
    await until(() => rt.socket.connected, 10_000);
    expect(gateway.tokens.slice(0, 2)).toEqual(['expired', 'good']);
  }, 15_000);
});

describe('query cache adapter', () => {
  it('merges messages by seq, ignores duplicates, and invalidates lists', () => {
    /** @type {Map<string, any>} */
    const data = new Map();
    /** @type {any[]} */
    /** @type {any[]} */
    const invalidated = [];
    const qc = {
      setQueryData: (/** @type {any} */ key, /** @type {any} */ fn) =>
        data.set(JSON.stringify(key), fn(data.get(JSON.stringify(key)))),
      invalidateQueries: (/** @type {any} */ q) => invalidated.push(JSON.stringify(q.queryKey)),
    };
    const keys = {
      messages: (/** @type {string} */ id) => ['m', id],
      matches: () => ['matches'],
      conversations: () => ['convs'],
      config: () => ['config'],
    };
    const adapter = queryCacheAdapter(qc, keys);
    const m = (/** @type {number} */ seq) => ({
      conversationId: 'c',
      seq,
      clientMsgId: `${seq}`,
      senderId: 's',
      kind: 'text',
      body: `${seq}`,
      createdAt: '',
    });
    adapter.onMessage(m(2));
    adapter.onMessage(m(1));
    adapter.onMessage(m(2));
    expect(data.get('["m","c"]').items.map((/** @type {any} */ x) => x.seq)).toEqual([1, 2]);
    adapter.onEvent('match.new');
    adapter.onEvent('config.changed');
    expect(invalidated).toEqual(expect.arrayContaining(['["matches"]', '["convs"]', '["config"]']));
  });
});
