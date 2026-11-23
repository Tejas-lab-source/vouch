// @ts-check
import { ApiError, keys } from '@vouch/api-client';
import { queryCacheAdapter } from '@vouch/realtime';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  mergeMessages,
  messageState,
  minutesToTime,
  timeToMinutes,
  unreadCount,
  useAccountActions,
  useBlockedUsers,
  useConversations,
  useMarkRead,
  useMessages,
  useNotificationPrefs,
  usePushRegistration,
  useSendMessage,
  useUnblock,
  useUpdateNotificationPrefs,
} from '../src/index.js';
import { fakeApi, wrapper } from './support.jsx';

const ID = (/** @type {number} */ n) => `01936f3e-8a4b-7c2d-9e1f-${String(n).padStart(12, '0')}`;
const ME = 'u_me_000000000000000000';
const THEM = 'u_them_0000000000000000';
const CONV = ID(50);
const msg = (/** @type {number} */ seq, from = THEM, body = `m${seq}`) => ({
  conversationId: CONV,
  seq,
  clientMsgId: ID(1000 + seq),
  senderId: from,
  kind: 'text',
  body,
  createdAt: '2026-11-22T10:00:00.000Z',
});
const profile = {
  userId: ME,
  status: 'active',
  name: 'Me',
  gender: 0,
  interestedIn: [1],
  bio: null,
  age: 21,
  minAge: 18,
  maxAge: 30,
  photos: [],
  sections: [],
  missing: [],
};

/**
 * A fake realtime client: `send` resolves or rejects when the test says so (an outbox that is
 * offline until "reconnect"), and every call is recorded.
 */
function fakeRealtime() {
  /** @type {{ payload: any, resolve: Function, reject: Function }[]} */
  const waiting = [];
  /** @type {any[]} */
  const sent = [];
  /** @type {[string, number][]} */
  const reads = [];
  return {
    sent,
    reads,
    waiting,
    send: (/** @type {any} */ payload) =>
      new Promise((resolve, reject) => {
        sent.push(payload);
        waiting.push({ payload, resolve, reject });
      }),
    markRead: (/** @type {string} */ c, /** @type {number} */ seq) => void reads.push([c, seq]),
    /** Acks the oldest waiting send with `seq`. @param {number} seq */
    ack(seq) {
      const item = /** @type {any} */ (waiting.shift());
      item.resolve({
        ok: true,
        clientMsgId: item.payload.clientMsgId,
        seq,
        createdAt: '2026-11-22T10:01:00.000Z',
      });
    },
    /** Refuses the oldest waiting send for good. @param {string} code */
    refuse(code) {
      const item = /** @type {any} */ (waiting.shift());
      item.reject(new ApiError({ code, message: 'x', status: 409 }));
    },
  };
}

function chatSetup(routes = {}) {
  const api = fakeApi({
    'GET /v1/me/profile': () => [200, profile],
    'GET /v1/conversations/:id/messages': (_b, _n, url) => {
      const before = Number(url.searchParams.get('beforeSeq'));
      if (before > 100)
        return [
          200,
          {
            items: [msg(3), msg(4)],
            nextAfterSeq: null,
            prevBeforeSeq: 3,
            peerDeliveredSeq: 0,
            peerReadSeq: 0,
          },
        ];
      return [
        200,
        {
          items: [msg(1), msg(2)],
          nextAfterSeq: null,
          prevBeforeSeq: null,
          peerDeliveredSeq: 0,
          peerReadSeq: 0,
        },
      ];
    },
    ...routes,
  });
  const realtime = fakeRealtime();
  const w = wrapper(api, /** @type {any} */ ({ realtime }));
  const adapter = queryCacheAdapter(w.queryClient, keys);
  return { api, realtime, adapter, ...w };
}

describe('chat: messages and their states', () => {
  it('opens at the newest page and loads older pages backwards', async () => {
    const { Wrapper, api } = chatSetup();
    const { result } = renderHook(() => useMessages(CONV), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.messages.map((m) => m.seq)).toEqual([3, 4]));
    expect(result.current.hasOlder).toBe(true);
    await act(async () => {
      await result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]));
    expect(result.current.hasOlder).toBe(false);
    const asked = api.calls.filter((c) => c.route === 'GET /v1/conversations/:id/messages');
    expect(asked).toHaveLength(2);
  });

  it('sending → sent (ack with seq) → delivered → read, from the receipts', async () => {
    const { Wrapper, realtime, adapter } = chatSetup();
    const { result } = renderHook(() => ({ list: useMessages(CONV), send: useSendMessage(CONV) }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.list.messages).toHaveLength(2));
    await waitFor(() => expect(result.current.list.me).toBe(ME));
    act(() => result.current.send.send('  hello  '));
    await waitFor(() =>
      expect(result.current.list.outgoing).toMatchObject([{ body: 'hello', state: 'sending' }]),
    );
    expect(realtime.sent).toEqual([
      { conversationId: CONV, body: 'hello', clientMsgId: expect.any(String) },
    ]);
    await act(async () => {
      realtime.ack(5);
    });
    await waitFor(() => expect(result.current.list.outgoing).toEqual([]));
    const mine = /** @type {any} */ (result.current.list.messages.at(-1));
    expect(mine).toMatchObject({ seq: 5, senderId: ME, body: 'hello' });
    expect(result.current.list.stateOf(mine)).toBe('sent');
    act(() =>
      adapter.onEvent('receipt.updated', { conversationId: CONV, deliveredSeq: 5, readSeq: 4 }),
    );
    await waitFor(() => expect(result.current.list.stateOf(mine)).toBe('delivered'));
    act(() =>
      adapter.onEvent('receipt.updated', { conversationId: CONV, deliveredSeq: 5, readSeq: 5 }),
    );
    await waitFor(() => expect(result.current.list.stateOf(mine)).toBe('read'));
    // The other person's messages carry no state.
    expect(
      result.current.list.stateOf(/** @type {any} */ (result.current.list.messages.at(0))),
    ).toBeNull();
  });

  it('a send queued while offline stays "sending" and is stored once when the outbox delivers it', async () => {
    const { Wrapper, realtime, adapter } = chatSetup();
    const { result } = renderHook(() => ({ list: useMessages(CONV), send: useSendMessage(CONV) }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.list.messages).toHaveLength(2));
    act(() => result.current.send.send('while offline'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result.current.list.outgoing).toMatchObject([{ state: 'sending' }]);
    // Reconnected: the outbox delivers it; the sender's echo (message.new) arrives as well.
    const clientMsgId = realtime.sent[0].clientMsgId;
    await act(async () => {
      realtime.ack(5);
      adapter.onMessage({ ...msg(5, ME, 'while offline'), clientMsgId });
    });
    await waitFor(() => expect(result.current.list.outgoing).toEqual([]));
    expect(result.current.list.messages.filter((m) => m.seq === 5)).toHaveLength(1);
    expect(realtime.sent).toHaveLength(1);
  });

  it('a final refusal marks the message failed; retry sends it again with the same clientMsgId', async () => {
    const { Wrapper, realtime } = chatSetup();
    const { result } = renderHook(() => ({ list: useMessages(CONV), send: useSendMessage(CONV) }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.list.messages).toHaveLength(2));
    act(() => result.current.send.send('hi'));
    await act(async () => {
      realtime.refuse('RATE_LIMITED');
    });
    await waitFor(() =>
      expect(result.current.list.outgoing).toMatchObject([
        { state: 'failed', error: 'RATE_LIMITED' },
      ]),
    );
    const id = result.current.list.outgoing[0]?.clientMsgId ?? '';
    act(() => result.current.send.retry(id));
    await waitFor(() => expect(result.current.list.outgoing).toMatchObject([{ state: 'sending' }]));
    expect(realtime.sent.map((p) => p.clientMsgId)).toEqual([id, id]);
    await act(async () => {
      realtime.ack(5);
    });
    await waitFor(() => expect(result.current.list.outgoing).toEqual([]));
  });

  it('live and replayed messages are merged by seq: never shown twice, always in order', async () => {
    const { Wrapper, adapter } = chatSetup();
    const { result } = renderHook(() => useMessages(CONV), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    act(() => {
      adapter.onMessage(msg(6));
      adapter.onMessage(msg(5));
      adapter.onMessage(msg(6)); // replay after a reconnect (sync)
    });
    await waitFor(() => expect(result.current.messages.map((m) => m.seq)).toEqual([3, 4, 5, 6]));
    expect(mergeMessages([msg(2), msg(1)], [msg(2), msg(3)]).map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('a closed conversation is reported to the screen', async () => {
    const { Wrapper, adapter } = chatSetup();
    const { result } = renderHook(() => useMessages(CONV), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    act(() =>
      adapter.onEvent('conversation.closed', { conversationId: CONV, reason: 'unmatched' }),
    );
    await waitFor(() => expect(result.current.closed).toBe('unmatched'));
  });

  it('states and unread counts', () => {
    const cursors = { peerDeliveredSeq: 4, peerReadSeq: 2 };
    expect(
      [1, 2, 3, 4, 5].map((seq) => messageState(/** @type {any} */ (msg(seq, ME)), cursors)),
    ).toEqual(['read', 'read', 'delivered', 'delivered', 'sent']);
    const summary = /** @type {any} */ ({ lastMessage: msg(7), lastReadSeq: 4 });
    expect(unreadCount(summary, ME)).toBe(3);
    expect(unreadCount({ ...summary, lastMessage: msg(7, ME) }, ME)).toBe(0);
    expect(unreadCount({ ...summary, lastMessage: null }, ME)).toBe(0);
  });

  it('marks read up to the newest visible message, once per new message, and clears the unread count', async () => {
    const summary = {
      conversationId: CONV,
      matchId: CONV,
      user: {},
      lastMessage: msg(4),
      lastReadSeq: 1,
      closed: false,
      updatedAt: '2026-11-22T10:00:00.000Z',
    };
    const { Wrapper, realtime } = chatSetup({
      'GET /v1/conversations': () => [200, { items: [summary], nextCursor: null }],
    });
    const { result, rerender } = renderHook(
      ({ visible }) => {
        const list = useMessages(CONV);
        const conversations = useConversations();
        useMarkRead(CONV, list.messages, visible);
        return { list, conversations };
      },
      { wrapper: Wrapper, initialProps: { visible: false } },
    );
    await waitFor(() => expect(result.current.list.messages).toHaveLength(2));
    await waitFor(() => expect(result.current.conversations.conversations).toHaveLength(1));
    expect(realtime.reads).toEqual([]); // not visible yet
    rerender({ visible: true });
    await waitFor(() => expect(realtime.reads).toEqual([[CONV, 4]]));
    await waitFor(() =>
      expect(
        result.current.conversations.unread(
          /** @type {any} */ (result.current.conversations.conversations[0]),
        ),
      ).toBe(0),
    );
    rerender({ visible: true });
    expect(realtime.reads).toHaveLength(1);
  });
});

describe('settings, safety and push', () => {
  it('notification prefs: read, save, and quiet-hours time conversion', async () => {
    let saved = {
      pushMatches: true,
      pushMessages: true,
      pushLikesDigest: true,
      quietHours: null,
      timezone: 'UTC',
    };
    const api = fakeApi({
      'GET /v1/me/notification-prefs': () => [200, saved],
      'PUT /v1/me/notification-prefs': (body) => {
        saved = body;
        return [200, body];
      },
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(
      () => ({ prefs: useNotificationPrefs(), save: useUpdateNotificationPrefs() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.prefs.data?.timezone).toBe('UTC'));
    const next = {
      ...saved,
      pushMessages: false,
      quietHours: { startMinute: 1320, endMinute: 420 },
      timezone: 'Asia/Kolkata',
    };
    await act(async () => {
      await result.current.save.mutateAsync(/** @type {any} */ (next));
    });
    await waitFor(() => expect(result.current.prefs.data).toEqual(next));
    expect(minutesToTime(1320)).toBe('22:00');
    expect(timeToMinutes('07:00')).toBe(420);
    expect(timeToMinutes('24:00')).toBeNull();
  });

  it('blocked users: list and unblock', async () => {
    const api = fakeApi({
      'GET /v1/me/blocks': () => [
        200,
        { items: [{ userId: THEM, name: 'Kabir', blockedAt: '2026-11-22T10:00:00.000Z' }] },
      ],
      'DELETE /v1/blocks/u_them_0000000000000000': () => [200, { unblocked: true }],
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(() => ({ list: useBlockedUsers(), unblock: useUnblock() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.list.data).toHaveLength(1));
    await act(async () => {
      await result.current.unblock.mutateAsync(THEM);
    });
    await waitFor(() => expect(result.current.list.data).toEqual([]));
  });

  it('log out of all devices revokes every other device, then this one', async () => {
    const api = fakeApi({
      'GET /v1/me/devices': () => [
        200,
        {
          items: [
            {
              id: ID(1),
              platform: 'web',
              appVersion: '1.0.0',
              createdAt: '2026-11-22T10:00:00.000Z',
              lastSeenAt: '2026-11-22T10:00:00.000Z',
              current: true,
            },
            {
              id: ID(2),
              platform: 'ios',
              appVersion: '1.0.0',
              createdAt: '2026-11-22T10:00:00.000Z',
              lastSeenAt: '2026-11-22T10:00:00.000Z',
              current: false,
            },
          ],
        },
      ],
      'DELETE /v1/me/devices/:id': () => [200, { revoked: true }],
      'POST /v1/auth/logout': () => [200, { loggedOut: true }],
    });
    const end = vi.fn(async () => {});
    const { Wrapper } = wrapper(api, /** @type {any} */ ({ session: { end } }));
    const { result } = renderHook(() => useAccountActions(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.signOutEverywhere.mutateAsync();
    });
    expect(api.calls.map((c) => c.route)).toEqual([
      'GET /v1/me/devices',
      'DELETE /v1/me/devices/:id',
      'POST /v1/auth/logout',
    ]);
    expect(end).toHaveBeenCalledOnce();
  });

  it('push: asked only when the app asks; a grant registers the token, a denial registers nothing', async () => {
    const api = fakeApi({ 'POST /v1/devices': (body) => [201, { deviceId: ID(9), ...body }] });
    let status = /** @type {'granted' | 'denied' | 'undetermined'} */ ('undetermined');
    const push = {
      platform: /** @type {const} */ ('android'),
      appVersion: '1.0.0',
      status: vi.fn(async () => status),
      request: vi.fn(async () => {
        status = 'granted';
        return /** @type {const} */ ('granted');
      }),
      token: vi.fn(async () => 'ExponentPushToken[abc]'),
    };
    const { Wrapper } = wrapper(api, /** @type {any} */ ({ push }));
    const { result } = renderHook(() => usePushRegistration(), { wrapper: Wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(push.request).not.toHaveBeenCalled(); // never at start-up
    expect(api.count('POST /v1/devices')).toBe(0);
    await act(async () => {
      expect(await result.current.askNow()).toBe('granted');
    });
    expect(api.calls.find((c) => c.route === 'POST /v1/devices')?.body).toEqual({
      pushToken: 'ExponentPushToken[abc]',
      platform: 'android',
      appVersion: '1.0.0',
    });

    const denied = {
      ...push,
      status: vi.fn(async () => /** @type {const} */ ('denied')),
      request: vi.fn(),
    };
    const api2 = fakeApi({});
    const w2 = wrapper(api2, /** @type {any} */ ({ push: denied }));
    const second = renderHook(() => usePushRegistration(), { wrapper: w2.Wrapper });
    await act(async () => {
      expect(await second.result.current.askNow()).toBe('denied');
    });
    expect(denied.request).not.toHaveBeenCalled();
    expect(api2.calls).toEqual([]);
  });
});
