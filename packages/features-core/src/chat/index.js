// @ts-check
import { keys, listConversations, listMessages } from '@vouch/api-client';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMyProfile } from '../profile/index.js';
import { useServices } from '../react.jsx';

/** Above any real seq: "the newest messages". */
const NEWEST = 2_147_483_647;
const PAGE = 30;

/**
 * @typedef {{ conversationId: string, seq: number, clientMsgId: string, senderId: string, kind: string, body: string, createdAt: string }} Message
 * @typedef {'sending' | 'sent' | 'delivered' | 'read' | 'failed'} MessageState
 * @typedef {{ clientMsgId: string, body: string, createdAt: string, state: 'sending' | 'failed', error: string | null }} Outgoing
 * @typedef {{
 *   items: Message[],
 *   prevBeforeSeq: number | null,
 *   peerDeliveredSeq: number,
 *   peerReadSeq: number,
 *   closed?: string | null,
 *   outgoing?: Outgoing[],
 *   loaded?: boolean,
 * }} MessagesCache  `keys.messages(id)`; realtime's cache adapter appends live messages.
 * @typedef {{ conversationId: string, matchId: string, user: import('../deck/index.js').ProfileCard, lastMessage: Message | null, lastReadSeq: number, closed: boolean, updatedAt: string }} ConversationSummary
 */

/**
 * Merges messages by seq (one per seq, sorted). A replayed or echoed message is never shown
 * twice.
 * @param {readonly Message[]} items @param {readonly Message[]} more
 * @returns {Message[]}
 */
export function mergeMessages(items, more) {
  const bySeq = new Map(items.map((m) => [m.seq, m]));
  for (const m of more) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The state of one of my stored messages, from the other member's cursors.
 * @param {Message} message
 * @param {{ peerDeliveredSeq: number, peerReadSeq: number }} cursors
 * @returns {MessageState}
 */
export function messageState(message, cursors) {
  if (message.seq <= cursors.peerReadSeq) return 'read';
  if (message.seq <= cursors.peerDeliveredSeq) return 'delivered';
  return 'sent';
}

/**
 * Unread messages in a conversation for me (messages from the other person after my cursor).
 * @param {ConversationSummary} summary @param {string | null} me  My public id.
 */
export function unreadCount(summary, me) {
  const last = summary.lastMessage;
  if (!last || last.senderId === me) return 0;
  return Math.max(0, last.seq - summary.lastReadSeq);
}

/** The caller's conversations, most recently active first (infinite). */
export function useConversations({ pageSize = 20 } = {}) {
  const { client } = useServices();
  const me = useMyProfile().data?.userId ?? null;
  const query = useInfiniteQuery({
    queryKey: keys.conversations(),
    initialPageParam: /** @type {string | undefined} */ (undefined),
    queryFn: ({ pageParam }) =>
      listConversations(client, {
        query: { limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  /** @type {ConversationSummary[]} */
  const conversations = query.data?.pages.flatMap((page) => page.items) ?? [];
  return {
    ...query,
    conversations,
    me,
    unread: (/** @type {ConversationSummary} */ c) => unreadCount(c, me),
  };
}

/**
 * One conversation's messages: the newest page first, older pages on demand (`loadOlder`),
 * live messages appended by realtime, and my outgoing messages with their states.
 * @param {string} conversationId
 */
export function useMessages(conversationId) {
  const { client } = useServices();
  const queryClient = useQueryClient();
  const me = useMyProfile().data?.userId ?? null;
  const key = keys.messages(conversationId);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const page = await listMessages(client, {
        params: { id: conversationId },
        query: { beforeSeq: NEWEST, limit: PAGE },
      });
      const current = /** @type {MessagesCache | undefined} */ (queryClient.getQueryData(key));
      // Keep anything realtime merged while this page was loading, and pending sends.
      return /** @type {MessagesCache} */ ({
        items: mergeMessages(current?.items ?? [], page.items),
        prevBeforeSeq: page.prevBeforeSeq,
        // The server's cursors are the truth (they may go down when read receipts are turned off).
        peerDeliveredSeq: page.peerDeliveredSeq,
        peerReadSeq: page.peerReadSeq,
        closed: current?.closed ?? null,
        outgoing: current?.outgoing ?? [],
        loaded: true,
      });
    },
    staleTime: Infinity,
    // Realtime may have created the entry (live messages only) before the screen opened.
    refetchOnMount: (q) => (/** @type {any} */ (q.state.data)?.loaded ? false : 'always'),
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const data = /** @type {MessagesCache | undefined} */ (query.data);

  const loadOlder = useCallback(async () => {
    const before = data?.prevBeforeSeq;
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await listMessages(client, {
        params: { id: conversationId },
        query: { beforeSeq: before, limit: PAGE },
      });
      queryClient.setQueryData(key, (/** @type {MessagesCache | undefined} */ c) =>
        c
          ? { ...c, items: mergeMessages(c.items, page.items), prevBeforeSeq: page.prevBeforeSeq }
          : c,
      );
    } finally {
      setLoadingOlder(false);
    }
  }, [client, conversationId, data?.prevBeforeSeq, key, loadingOlder, queryClient]);

  const cursors = {
    peerDeliveredSeq: data?.peerDeliveredSeq ?? 0,
    peerReadSeq: data?.peerReadSeq ?? 0,
  };
  return {
    ...query,
    me,
    messages: data?.items ?? [],
    outgoing: data?.outgoing ?? [],
    closed: data?.closed ?? null,
    hasOlder: Boolean(data?.prevBeforeSeq),
    loadingOlder,
    loadOlder,
    /** @param {Message} m @returns {MessageState | null} null for the other person's messages */
    stateOf: (m) => (m.senderId === me ? messageState(m, cursors) : null),
  };
}

/**
 * Sends messages through the realtime outbox: the message shows as `sending` at once, becomes
 * a stored message (`sent`, then `delivered`/`read` from receipts) on the ack, and stays
 * queued while offline (the outbox retries with the same `clientMsgId`, so it is stored once).
 * A final refusal (for example a closed conversation) marks it `failed`; `retry` sends it again
 * with the same `clientMsgId`.
 * @param {string} conversationId
 */
export function useSendMessage(conversationId) {
  const { realtime, newId = () => /** @type {any} */ (globalThis).crypto.randomUUID() } =
    useServices();
  const queryClient = useQueryClient();
  const me = useMyProfile().data?.userId ?? null;
  const key = keys.messages(conversationId);

  const update = useCallback(
    (/** @type {(c: MessagesCache) => MessagesCache} */ fn) =>
      queryClient.setQueryData(key, (/** @type {MessagesCache | undefined} */ c) =>
        fn(
          c ?? {
            items: [],
            prevBeforeSeq: null,
            peerDeliveredSeq: 0,
            peerReadSeq: 0,
            outgoing: [],
          },
        ),
      ),
    [key, queryClient],
  );

  const deliver = useCallback(
    /** @param {string} clientMsgId @param {string} body */
    async (clientMsgId, body) => {
      if (!realtime) throw new Error('realtime is not available');
      try {
        const ack = /** @type {any} */ (await realtime.send({ conversationId, body, clientMsgId }));
        update((c) => ({
          ...c,
          outgoing: (c.outgoing ?? []).filter((o) => o.clientMsgId !== clientMsgId),
          items: mergeMessages(c.items, [
            {
              conversationId,
              seq: ack.seq,
              clientMsgId,
              senderId: /** @type {string} */ (me),
              kind: 'text',
              body,
              createdAt: ack.createdAt,
            },
          ]),
        }));
        void queryClient.invalidateQueries({ queryKey: keys.conversations() });
      } catch (error) {
        const code = /** @type {any} */ (error)?.code ?? 'INTERNAL';
        update((c) => ({
          ...c,
          outgoing: (c.outgoing ?? []).map((o) =>
            o.clientMsgId === clientMsgId ? { ...o, state: 'failed', error: code } : o,
          ),
        }));
      }
    },
    [conversationId, me, queryClient, realtime, update],
  );

  const send = useCallback(
    /** @param {string} text */
    (text) => {
      const body = text.trim();
      if (!body) return;
      const clientMsgId = newId();
      update((c) => ({
        ...c,
        outgoing: [
          ...(c.outgoing ?? []),
          { clientMsgId, body, createdAt: new Date().toISOString(), state: 'sending', error: null },
        ],
      }));
      void deliver(clientMsgId, body);
    },
    [deliver, newId, update],
  );

  const retry = useCallback(
    /** @param {string} clientMsgId */
    (clientMsgId) => {
      const c = /** @type {MessagesCache | undefined} */ (queryClient.getQueryData(key));
      const item = c?.outgoing?.find((o) => o.clientMsgId === clientMsgId);
      if (!item) return;
      update((cache) => ({
        ...cache,
        outgoing: (cache.outgoing ?? []).map((o) =>
          o.clientMsgId === clientMsgId ? { ...o, state: 'sending', error: null } : o,
        ),
      }));
      void deliver(clientMsgId, item.body);
    },
    [deliver, key, queryClient, update],
  );

  return { send, retry };
}

/**
 * Marks the conversation read up to its newest message while the screen shows it (and the page
 * is visible). Only moves forward; the conversation list's unread count updates at once.
 * @param {string} conversationId @param {readonly Message[]} messages @param {boolean} visible
 */
export function useMarkRead(conversationId, messages, visible) {
  const { realtime } = useServices();
  const queryClient = useQueryClient();
  const reported = useRef(0);
  const newest = messages.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (!visible || !realtime || newest <= reported.current) return;
    reported.current = newest;
    realtime.markRead(conversationId, newest);
    queryClient.setQueryData(keys.conversations(), (/** @type {any} */ data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((/** @type {any} */ page) => ({
              ...page,
              items: page.items.map((/** @type {ConversationSummary} */ c) =>
                c.conversationId === conversationId
                  ? { ...c, lastReadSeq: Math.max(c.lastReadSeq, newest) }
                  : c,
              ),
            })),
          }
        : data,
    );
  }, [conversationId, newest, visible, realtime, queryClient]);
}
