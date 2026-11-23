// @ts-check
import { keys } from '@vouch/api-client';

/** Messages kept on the device per conversation (roadmap Phase 13). */
export const KEEP_PER_CONVERSATION = 50;
const INDEX = 'vouch.chat.index';
const PREFIX = 'vouch.chat.';

/**
 * @typedef {object} KeyValueStorage  AsyncStorage's shape (mobile).
 * @property {(key: string) => Promise<string | null>} getItem
 * @property {(key: string, value: string) => Promise<void>} setItem
 * @property {(key: string) => Promise<void>} removeItem
 */

/**
 * Keeps the last 50 messages of each open conversation on the device, so a cold start (or no
 * network) shows recent history at once; `sync` then fills the gap. Only the messages already
 * on screen are stored (no profiles, no tokens), and `clear()` removes everything at sign-out
 * or account deletion.
 * @param {{ storage: KeyValueStorage, queryClient: import('@tanstack/react-query').QueryClient, debounceMs?: number }} options
 */
export function createMessagePersistence({ storage, queryClient, debounceMs = 500 }) {
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();

  async function index() {
    try {
      const raw = await storage.getItem(INDEX);
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  /** @param {string} conversationId */
  async function save(conversationId) {
    const data = /** @type {any} */ (queryClient.getQueryData(keys.messages(conversationId)));
    const items = Array.isArray(data?.items) ? data.items.slice(-KEEP_PER_CONVERSATION) : [];
    if (items.length === 0) return;
    await storage.setItem(`${PREFIX}${conversationId}`, JSON.stringify(items));
    const ids = await index();
    if (!ids.has(conversationId)) {
      ids.add(conversationId);
      await storage.setItem(INDEX, JSON.stringify([...ids]));
    }
  }

  return {
    /**
     * Puts saved messages into the cache (marked not loaded, so opening the screen still
     * fetches the newest page).
     */
    async restore() {
      for (const conversationId of await index()) {
        try {
          const raw = await storage.getItem(`${PREFIX}${conversationId}`);
          const items = raw ? JSON.parse(raw) : null;
          if (!Array.isArray(items) || items.length === 0) continue;
          queryClient.setQueryData(
            keys.messages(conversationId),
            (/** @type {any} */ current) =>
              current ?? {
                items,
                prevBeforeSeq: null,
                peerDeliveredSeq: 0,
                peerReadSeq: 0,
                outgoing: [],
                loaded: false,
              },
          );
        } catch {
          // A damaged entry is skipped; the server is the source of truth.
        }
      }
    },
    /** Starts saving message caches as they change (debounced). @returns {() => void} stop */
    start() {
      return queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (key.at(0) !== 'vouch' || key.at(1) !== 'messages' || typeof key.at(2) !== 'string')
          return;
        const conversationId = /** @type {string} */ (key.at(2));
        const pending = timers.get(conversationId);
        if (pending) clearTimeout(pending);
        timers.set(
          conversationId,
          setTimeout(() => {
            timers.delete(conversationId);
            void save(conversationId).catch(() => {});
          }, debounceMs),
        );
      });
    },
    /** Removes every saved message (sign-out, account deletion). */
    async clear() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const conversationId of await index())
        await storage.removeItem(`${PREFIX}${conversationId}`);
      await storage.removeItem(INDEX);
    },
  };
}
