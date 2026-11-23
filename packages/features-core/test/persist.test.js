// @ts-check
import { keys } from '@vouch/api-client';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  createMessagePersistence,
  KEEP_PER_CONVERSATION,
  notificationTarget,
} from '../src/index.js';

const CONV = '01936f3e-8a4b-7c2d-9e1f-000000000050';
const msg = (/** @type {number} */ seq) => ({
  conversationId: CONV,
  seq,
  clientMsgId: `${seq}`,
  senderId: 's',
  kind: 'text',
  body: `m${seq}`,
  createdAt: '',
});

function memoryStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    map,
    getItem: async (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: async (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v),
    removeItem: async (/** @type {string} */ k) => void map.delete(k),
  };
}

describe('offline message cache (mobile)', () => {
  it('keeps the last 50 messages per conversation, restores them after a restart, and clears at sign-out', async () => {
    const storage = memoryStorage();
    const first = new QueryClient();
    const persistence = createMessagePersistence({ storage, queryClient: first, debounceMs: 5 });
    const stop = persistence.start();
    first.setQueryData(keys.messages(CONV), {
      items: Array.from({ length: 80 }, (_, i) => msg(i + 1)),
      loaded: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    const saved = JSON.parse(/** @type {string} */ (storage.map.get(`vouch.chat.${CONV}`)));
    expect(saved).toHaveLength(KEEP_PER_CONVERSATION);
    expect(saved.at(0).seq).toBe(31);

    // "Restart": a new cache, restored from the device.
    const second = new QueryClient();
    await createMessagePersistence({ storage, queryClient: second }).restore();
    const restored = /** @type {any} */ (second.getQueryData(keys.messages(CONV)));
    expect(restored.items.map((/** @type {any} */ m) => m.seq).at(-1)).toBe(80);
    expect(restored.loaded).toBe(false); // the screen still fetches the newest page

    await createMessagePersistence({ storage, queryClient: second }).clear();
    expect([...storage.map.keys()]).toEqual([]);
  });

  it('ignores damaged entries', async () => {
    const storage = memoryStorage();
    storage.map.set('vouch.chat.index', JSON.stringify([CONV]));
    storage.map.set(`vouch.chat.${CONV}`, '{not json');
    const qc = new QueryClient();
    await createMessagePersistence({ storage, queryClient: qc }).restore();
    expect(qc.getQueryData(keys.messages(CONV))).toBeUndefined();
  });
});

describe('notification taps', () => {
  it('open the conversation, or the matching screen, and never trust malformed data', () => {
    expect(notificationTarget({ type: 'message.new', conversationId: CONV })).toEqual({
      screen: 'chat',
      conversationId: CONV,
    });
    expect(notificationTarget({ type: 'match.new', matchId: CONV, conversationId: CONV })).toEqual({
      screen: 'chat',
      conversationId: CONV,
    });
    expect(notificationTarget({ type: 'match.new', conversationId: '../../etc' })).toEqual({
      screen: 'matches',
    });
    expect(notificationTarget({ type: 'likes.digest' })).toEqual({ screen: 'discover' });
    expect(notificationTarget(null)).toEqual({ screen: 'home' });
  });
});
