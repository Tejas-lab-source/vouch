// @ts-check

/**
 * @typedef {object} Message  As the server sends it (`message.new`, `sync`).
 * @property {string} conversationId
 * @property {number} seq
 * @property {string} clientMsgId
 * @property {string} senderId
 * @property {string} kind
 * @property {string} body
 * @property {string} createdAt
 */

/**
 * @typedef {object} CursorStore  The last seq seen per conversation, kept across reconnects
 *   (and app restarts, when the store persists).
 * @property {() => { conversationId: string, lastSeq: number }[]} all
 * @property {(conversationId: string, seq: number) => void} advance  Never moves backwards.
 */

/** An in-memory cursor store. */
export function memoryCursors() {
  /** @type {Map<string, number>} */
  const seqs = new Map();
  return {
    all: () => [...seqs].map(([conversationId, lastSeq]) => ({ conversationId, lastSeq })),
    /** @param {string} conversationId @param {number} seq */
    advance(conversationId, seq) {
      if (seq > (seqs.get(conversationId) ?? 0)) seqs.set(conversationId, seq);
    },
  };
}

/** Errors that will not get better by retrying the same message. */
const FINAL_ERRORS = new Set([
  'MESSAGE_REJECTED',
  'CONVERSATION_CLOSED',
  'NOT_A_MEMBER',
  'NOT_FOUND',
  'VALIDATION_FAILED',
]);
const REFRESH_BEFORE_MS = 60_000;
const ACK_TIMEOUT_MS = 10_000;

/**
 * The realtime client (Phase 11; ADR 0017 on the server side).
 * - Connects with the current access token (WebSocket only), and reconnects with exponential
 *   backoff and jitter (1 s → 30 s).
 * - Sends `auth.refresh` a minute before the token expires; if the server still ends the
 *   socket (`auth.expired`), the next reconnect uses a fresh token.
 * - After every connect, calls `sync` with the stored cursors and delivers the missed
 *   messages before live ones; messages are delivered once per (conversation, seq).
 * - `send()` queues a message with a stable `clientMsgId`. It is retried with the same id
 *   after a failure or reconnect until acknowledged, so the server stores it once.
 * @param {{
 *   url: string,
 *   connect: (url: string, options: any) => any,  // socket.io-client's `io`
 *   session: { accessToken: () => string | null, expiresAt: () => number | null, refresh: () => Promise<string> },
 *   cursors?: CursorStore,
 *   onMessage?: (message: Message) => void,
 *   onEvent?: (event: string, payload: any) => void,
 *   onStatus?: (status: 'connecting' | 'online' | 'offline') => void,
 *   newId?: () => string,
 *   now?: () => number,
 * }} options
 */
export function createRealtime({
  url,
  connect,
  session,
  cursors = memoryCursors(),
  onMessage = () => {},
  onEvent = () => {},
  onStatus = () => {},
  newId = () => globalThis.crypto.randomUUID(),
  now = () => Date.now(),
}) {
  /** @type {Set<string>} Delivered (conversation, seq) pairs. */
  const seen = new Set();
  /** @type {{ payload: any, resolve: (ack: any) => void, reject: (error: any) => void, inFlight: boolean }[]} */
  const outbox = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let refreshTimer = null;
  let stopped = false;
  let serverDrops = 0;

  const socket = connect(url, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    // Called on every (re)connect, so a reconnect after expiry uses the refreshed token.
    auth: (/** @type {(data: object) => void} */ cb) => cb({ token: session.accessToken() }),
  });

  /** @param {Message} message */
  function deliver(message) {
    const key = `${message.conversationId}:${message.seq}`;
    if (seen.has(key)) return;
    seen.add(key);
    cursors.advance(message.conversationId, message.seq);
    onMessage(message);
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    const expiresAt = session.expiresAt();
    if (!expiresAt) return;
    const wait = Math.max(0, expiresAt - REFRESH_BEFORE_MS - now());
    refreshTimer = setTimeout(async () => {
      try {
        const token = await session.refresh();
        const ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('auth.refresh', { token });
        if (ack?.ok) scheduleRefresh();
      } catch {
        // The server disconnects at expiry; the reconnect path signs in again.
      }
    }, wait);
  }

  async function syncMissed() {
    const list = cursors.all();
    if (list.length === 0) return;
    const reply = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('sync', { cursors: list });
    if (!reply?.ok) return;
    for (const message of reply.messages ?? []) deliver(message);
    // More than one page was missed: ask again from the new cursors.
    if (reply.truncated) await syncMissed();
  }

  async function flush() {
    for (const item of outbox) {
      if (item.inFlight || !socket.connected) continue;
      item.inFlight = true;
      try {
        const ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('message.send', item.payload);
        item.inFlight = false;
        if (ack?.ok) {
          outbox.splice(outbox.indexOf(item), 1);
          item.resolve(ack);
        } else if (FINAL_ERRORS.has(ack?.error?.code)) {
          outbox.splice(outbox.indexOf(item), 1);
          item.reject(ack.error);
        }
        // Other errors (rate limited, unavailable) stay queued for the next attempt.
      } catch {
        // Timed out or disconnected: kept, retried with the same clientMsgId.
        item.inFlight = false;
      }
    }
  }

  socket.on('connect', async () => {
    serverDrops = 0;
    onStatus('online');
    scheduleRefresh();
    await syncMissed().catch(() => {});
    await flush();
  });
  socket.on('disconnect', (/** @type {string} */ reason) => {
    onStatus('offline');
    // socket.io does not reconnect after a server-side disconnect (a gateway draining for a
    // deploy, or ending an expired session). Reconnect after a jittered, growing delay.
    if (reason === 'io server disconnect' && !stopped) {
      serverDrops += 1;
      const delay =
        Math.min(30_000, 500 * 2 ** Math.min(serverDrops - 1, 6)) * (0.5 + Math.random());
      setTimeout(() => {
        if (!stopped && !socket.connected) socket.connect();
      }, delay);
    }
  });
  socket.on('connect_error', async (/** @type {any} */ error) => {
    onStatus('offline');
    if (error?.data?.code === 'UNAUTHENTICATED') {
      // The handshake token was stale: refresh, and let the built-in reconnect retry.
      await session.refresh().catch(() => {});
      if (!socket.active) socket.connect();
    }
  });
  socket.on('message.new', deliver);
  socket.on('auth.expired', async () => {
    await session.refresh().catch(() => {});
  });
  for (const event of ['match.new', 'conversation.closed', 'config.changed']) {
    socket.on(event, (/** @type {any} */ payload) => onEvent(event, payload));
  }

  return {
    socket,
    start() {
      stopped = false;
      onStatus('connecting');
      socket.connect();
    },
    stop() {
      stopped = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.disconnect();
    },
    /**
     * Queues a text message; resolves with the server's ack (`{ ok, clientMsgId, seq }`).
     * @param {{ conversationId: string, body: string, clientMsgId?: string }} message
     */
    send({ conversationId, body, clientMsgId = newId() }) {
      return new Promise((resolve, reject) => {
        outbox.push({
          payload: { conversationId, clientMsgId, kind: 'text', body },
          resolve,
          reject,
          inFlight: false,
        });
        void flush();
      });
    },
    /** @param {string} conversationId @param {number} seq */
    markRead: (conversationId, seq) =>
      socket.timeout(ACK_TIMEOUT_MS).emitWithAck('message.read', { conversationId, seq }),
    /** Messages waiting for an ack (for "sending…" indicators). */
    pending: () => outbox.map((item) => item.payload),
  };
}

/**
 * Feeds realtime events into the TanStack Query cache: `message.new` (and replayed messages)
 * merge into `keys.messages(id)` by seq; `match.new` and `conversation.closed` invalidate the
 * lists; `config.changed` refetches the config.
 * @param {{ setQueryData: Function, invalidateQueries: Function }} queryClient
 * @param {{ messages: (id: string) => readonly unknown[], matches: () => readonly unknown[], conversations: () => readonly unknown[], config: () => readonly unknown[] }} keys
 */
export function queryCacheAdapter(queryClient, keys) {
  return {
    /** @param {Message} message */
    onMessage(message) {
      queryClient.setQueryData(
        keys.messages(message.conversationId),
        (/** @type {any} */ current) => {
          const items = /** @type {Message[]} */ (current?.items ?? []);
          if (items.some((m) => m.seq === message.seq)) return current;
          return { ...(current ?? {}), items: [...items, message].sort((a, b) => a.seq - b.seq) };
        },
      );
      queryClient.invalidateQueries({ queryKey: keys.conversations() });
    },
    /** @param {string} event */
    onEvent(event) {
      if (event === 'match.new') queryClient.invalidateQueries({ queryKey: keys.matches() });
      if (event === 'match.new' || event === 'conversation.closed') {
        queryClient.invalidateQueries({ queryKey: keys.conversations() });
      }
      if (event === 'config.changed') queryClient.invalidateQueries({ queryKey: keys.config() });
    },
  };
}
