// Phase 14 load test: 10x the beta peak against the beta plan's resources (load/README.md).
//   HTTP 470 req/s (browsing, deck and swipes), 125 swipes/s, 6,000 sockets, 31 messages/s.
// Run through load/run.sh (grafana/k6 in Docker). Plain k6 JavaScript (not Node).
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { WebSocket } from 'k6/experimental/websockets';
import { setInterval, setTimeout, clearInterval } from 'k6/timers';

const BASE = __ENV.BASE_URL || 'http://api:3000';
const WS = BASE.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
const DURATION_S = Number(__ENV.DURATION_S || 300);
const RAMP_S = Number(__ENV.RAMP_S || 60);
const SCALE = Number(__ENV.SCALE || 1); // 1 = 10x the beta peak
const SOCKETS = Math.round(6000 * SCALE);
const SOCKETS_PER_VU = 100;
const MESSAGES_PER_S = 31 * SCALE;
const SWIPES_PER_S = Math.max(1, Math.round(125 * SCALE));
const BROWSE_PER_S = Math.max(1, Math.round(470 * SCALE - SWIPES_PER_S - SWIPES_PER_S / 9));

const users = JSON.parse(open('../out/users.json'));
const pairs = JSON.parse(open('../out/pairs.json'));
const HEADERS = { 'x-app-version': '1.0.0', 'content-type': 'application/json' };
const auth = (u) => ({ headers: { ...HEADERS, authorization: `Bearer ${u.token}` } });

// Latency per route (ms), errors, and chat timings.
const ROUTES = [
  'getMyProfile',
  'listMatches',
  'listConversations',
  'listMessages',
  'getConfig',
  'getLikesCount',
  'getNotificationPrefs',
  'getDeck',
  'swipe',
];
const routeTrend = Object.fromEntries(ROUTES.map((r) => [r, new Trend(`route_${r}`, true)]));
const httpErrors = new Counter('http_errors');
const ack = new Trend('message_ack', true);
const delivery = new Trend('message_delivery', true);
const sent = new Counter('messages_sent');
const received = new Counter('messages_received');
const socketErrors = new Counter('socket_errors');
const socketsOpen = new Counter('sockets_connected');
const reconnects = new Counter('socket_reconnects');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'avg', 'max', 'count'],
  scenarios: {
    sockets: {
      executor: 'per-vu-iterations',
      exec: 'sockets',
      vus: Math.ceil(SOCKETS / SOCKETS_PER_VU),
      iterations: 1,
      maxDuration: `${DURATION_S + RAMP_S + 60}s`,
    },
    browse: {
      executor: 'constant-arrival-rate',
      exec: 'browse',
      rate: BROWSE_PER_S,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      startTime: `${RAMP_S}s`,
      preAllocatedVUs: 200,
      maxVUs: 1500,
    },
    swipe: {
      executor: 'constant-arrival-rate',
      exec: 'swipe',
      rate: SWIPES_PER_S,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      startTime: `${RAMP_S}s`,
      preAllocatedVUs: 100,
      maxVUs: 1000,
    },
  },
};

/** @param {string} route @param {any} res @param {number} [expected] */
function record(route, res, expected = 200) {
  routeTrend[route].add(res.timings.duration);
  const ok = check(res, { [`${route} ${expected}`]: (r) => r.status === expected });
  if (!ok) httpErrors.add(1, { route, status: String(res.status) });
  return ok;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Browsing: the reads a client makes when opening screens. */
export function browse() {
  const pair = pick(pairs);
  const u = Math.random() < 0.5 ? users[pair.a] : pick(users);
  const roll = Math.random();
  if (roll < 0.2) record('getMyProfile', http.get(`${BASE}/v1/me/profile`, auth(u)));
  else if (roll < 0.4) record('listMatches', http.get(`${BASE}/v1/matches`, auth(u)));
  else if (roll < 0.6) record('listConversations', http.get(`${BASE}/v1/conversations`, auth(u)));
  else if (roll < 0.75) {
    const member = users[pair.a];
    record(
      'listMessages',
      http.get(`${BASE}/v1/conversations/${pair.conversationId}/messages?limit=30`, auth(member)),
    );
  } else if (roll < 0.85) record('getConfig', http.get(`${BASE}/v1/config`, auth(u)));
  else if (roll < 0.95) record('getLikesCount', http.get(`${BASE}/v1/me/likes/count`, auth(u)));
  else record('getNotificationPrefs', http.get(`${BASE}/v1/me/notification-prefs`, auth(u)));
}

// Each swiping VU keeps its user's unswiped cards (one deck call per page of cards).
const swipers = users.slice(0, Math.max(1, users.length - 2 * pairs.length));
let me = null;
let cards = [];

/** Swiping: fetch a deck page when out of cards, then swipe one card. */
export function swipe() {
  if (!me || cards.length === 0) {
    me = pick(swipers);
    const deck = http.get(`${BASE}/v1/deck`, auth(me));
    if (!record('getDeck', deck)) return;
    cards = deck.json('cards').map((c) => c.userId);
    if (cards.length === 0) return;
  }
  const targetId = cards.shift();
  const res = http.post(
    `${BASE}/v1/swipes`,
    JSON.stringify({ swipeId: uuid(), targetId, direction: Math.random() < 0.5 ? 'like' : 'pass' }),
    auth(me),
  );
  record('swipe', res);
}

/**
 * Sockets: each VU opens SOCKETS_PER_VU Socket.IO connections (engine.io v4 over a raw
 * WebSocket) and holds them. The first sockets belong to the chat pairs; each pair's first
 * member sends a message every 2 * pairs / MESSAGES_PER_S seconds.
 */
export function sockets() {
  const first = (__VU - 1) * SOCKETS_PER_VU;
  const end = Math.min(first + SOCKETS_PER_VU, SOCKETS);
  const totalMs = (DURATION_S + RAMP_S) * 1000;
  for (let i = first; i < end; i += 1) {
    // Socket i connects at (i / SOCKETS) of the ramp, so the connects are spread evenly.
    const at = (i / SOCKETS) * RAMP_S * 1000;
    setTimeout(() => connect(i, totalMs - at), at);
  }
}

/** @param {number} i @param {number} holdMs */
function connect(i, holdMs) {
  const endAt = Date.now() + holdMs;
  const pairIndex = Math.floor(i / 2);
  const inPair = pairIndex < pairs.length;
  const pair = inPair ? pairs[pairIndex] : null;
  const user = inPair ? users[i % 2 === 0 ? pair.a : pair.b] : users[i % users.length];
  const sender = inPair && i % 2 === 0;
  const ws = new WebSocket(WS);
  /** @type {Map<number, number>} ack id → sent at */
  const pending = new Map();
  let nextAck = 1;
  let timer = null;

  ws.onmessage = (event) => {
    const data = String(event.data);
    if (data.startsWith('0')) {
      ws.send(`40${JSON.stringify({ token: user.token })}`);
    } else if (data === '2') {
      ws.send('3');
    } else if (data.startsWith('40')) {
      socketsOpen.add(1);
      if (sender && MESSAGES_PER_S > 0) {
        const everyMs = ((pairs.length / MESSAGES_PER_S) * 1000) | 0;
        timer = setInterval(() => {
          const id = nextAck++;
          pending.set(id, Date.now());
          ws.send(
            `42${id}${JSON.stringify([
              'message.send',
              {
                conversationId: pair.conversationId,
                clientMsgId: uuid(),
                kind: 'text',
                body: `t=${Date.now()}`,
              },
            ])}`,
          );
          sent.add(1);
        }, everyMs);
      }
    } else if (data.startsWith('44')) {
      socketErrors.add(1, { stage: 'connect' });
    } else if (data.startsWith('43')) {
      const match = /^43(\d+)/.exec(data);
      const id = match ? Number(match[1]) : 0;
      if (pending.has(id)) {
        ack.add(Date.now() - pending.get(id));
        pending.delete(id);
        if (!data.includes('"ok":true')) socketErrors.add(1, { stage: 'ack' });
      }
    } else if (data.startsWith('42["message.new"')) {
      const t = /t=(\d+)/.exec(data);
      if (t && !sender) {
        delivery.add(Date.now() - Number(t[1]));
        received.add(1);
      }
    }
  };
  ws.onerror = () => socketErrors.add(1, { stage: 'transport' });
  let done = false;
  // A dropped connection reconnects like a client would (after a jittered pause), until the
  // run ends (chaos: the API or Redis is killed mid-run).
  ws.onclose = () => {
    if (timer) clearInterval(timer);
    timer = null;
    const left = endAt - Date.now();
    if (!done && left > 3000) {
      reconnects.add(1);
      setTimeout(() => connect(i, endAt - Date.now()), 1000 + Math.random() * 2000);
    }
  };
  setTimeout(() => {
    done = true;
    if (timer) clearInterval(timer);
    ws.close();
  }, holdMs);
}

export function handleSummary(data) {
  return { '/out/summary.json': JSON.stringify(data, null, 2) };
}
