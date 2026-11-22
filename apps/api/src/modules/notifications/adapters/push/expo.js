// @ts-check

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TIMEOUT_MS = 10_000;
/** Expo accepts at most 100 messages per send request and 1,000 ids per receipts request. */
export const SEND_CHUNK = 100;
export const RECEIPT_CHUNK = 1000;

/**
 * Expo push over plain HTTPS (no SDK, owner preference). Chunks of 100 messages; tickets come
 * back in order. A ticket or receipt with `DeviceNotRegistered` marks its token invalid.
 * @param {{ accessToken?: string, fetchImpl?: typeof fetch, sendUrl?: string, receiptsUrl?: string }} options
 * @returns {import('../../ports.js').PushProvider}
 */
export function createExpoPush({
  accessToken,
  fetchImpl = fetch,
  sendUrl = SEND_URL,
  receiptsUrl = RECEIPTS_URL,
}) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };

  /** @param {string} url @param {unknown} body */
  async function post(url, body) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Expo push returned ${response.status}`);
    return /** @type {any} */ (await response.json());
  }

  return {
    name: 'expo',
    async send(messages) {
      /** @type {import('../../ports.js').PushTicket[]} */
      const tickets = [];
      for (let i = 0; i < messages.length; i += SEND_CHUNK) {
        const chunk = messages.slice(i, i + SEND_CHUNK);
        const { data } = await post(
          sendUrl,
          chunk.map((m) => ({
            to: m.token,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            priority: 'high',
          })),
        );
        chunk.forEach((m, j) => {
          const t = data?.at?.(j) ?? {};
          tickets.push({
            token: m.token,
            ticketId: t.status === 'ok' ? String(t.id) : null,
            error: t.status === 'ok' ? null : String(t.details?.error ?? t.message ?? 'unknown'),
          });
        });
      }
      return tickets;
    },
    async receipts(ticketIds) {
      /** @type {Map<string, string | null>} */
      const out = new Map();
      for (let i = 0; i < ticketIds.length; i += RECEIPT_CHUNK) {
        const { data } = await post(receiptsUrl, { ids: ticketIds.slice(i, i + RECEIPT_CHUNK) });
        for (const [id, r] of Object.entries(data ?? {})) {
          const receipt = /** @type {any} */ (r);
          out.set(id, receipt.status === 'ok' ? null : String(receipt.details?.error ?? 'unknown'));
        }
      }
      return out;
    },
  };
}
