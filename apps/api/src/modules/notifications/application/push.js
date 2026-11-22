// @ts-check
import { inQuietHours } from '../domain/quiet-hours.js';

const DEFAULT_PREFS = Object.freeze({
  pushMatches: true,
  pushMessages: true,
  pushLikesDigest: true,
  quietHours: null,
  timezone: 'Asia/Kolkata',
});
/** Expo asks to read receipts about 15 minutes after sending. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const TICKET_TTL_S = 24 * 3600;
const CANCEL_TTL_S = 3600;

/** @param {any} row */
export const prefsView = (row) =>
  row
    ? {
        pushMatches: row.pushMatches,
        pushMessages: row.pushMessages,
        pushLikesDigest: row.pushLikesDigest,
        quietHours:
          row.quietStartMinute === null
            ? null
            : { startMinute: row.quietStartMinute, endMinute: row.quietEndMinute },
        timezone: row.timezone,
      }
    : { ...DEFAULT_PREFS };

/** @param {string} a @param {string} b */
export const pairKey = (a, b) => `notifications:cancel:${[a, b].sort().join(':')}`;

/**
 * Queueing and sending pushes. Every attempt is one `deliveries` row: `suppressed` (preference
 * off, quiet hours, batched or cancelled), `sent` or `failed`. Bodies are never stored.
 * @param {import('../ports.js').NotificationDeps} deps
 */
export function makePush(deps) {
  const { uow, read, push, templates, identity, jobs, redis, clock, newId, logger } = deps;

  /**
   * Decides whether a push goes out, logs the delivery and enqueues `notifications.sendPush`.
   * `dedupeKey` makes redelivered events no-ops; `from` is the other user (block cancel check).
   * `batched` logs a message push that fell inside the batching window as suppressed.
   * @param {{ userId: string, template: string, params: Record<string, string>, dedupeKey: string, from?: string, batched?: boolean }} input
   * @returns {Promise<'queued' | 'suppressed' | 'duplicate'>}
   */
  async function queue({ userId, template, params, dedupeKey, from, batched = false }) {
    const definition = templates.get(template);
    if (!definition) throw new Error(`unknown notification template ${template}`);
    const prefs = prefsView(await read((stores) => stores.prefs.find(userId)));
    const now = clock.now();
    const suppressedBy = batched
      ? 'batched'
      : !prefs[definition.pref]
        ? 'preference'
        : inQuietHours(prefs.quietHours, prefs.timezone, now)
          ? 'quiet_hours'
          : null;
    const id = newId();
    const inserted = await uow.run(({ stores }) =>
      stores.deliveries.insert({
        id,
        userId,
        template,
        status: suppressedBy ? 'suppressed' : 'queued',
        dedupeKey,
        errorCode: suppressedBy,
        createdAt: now,
      }),
    );
    if (!inserted) return 'duplicate';
    if (suppressedBy) return 'suppressed';
    await jobs.add('notifications.sendPush', {
      deliveryId: id,
      userId,
      template,
      params: from ? { ...params, from } : params,
    });
    return 'queued';
  }

  /**
   * `notifications.sendPush`: renders the template and sends it to every signed-in device.
   * Invalid tokens reported in the tickets are removed at once; the rest are checked in
   * `notifications.checkReceipts`.
   * @param {{ deliveryId: string, userId: string, template: string, params: Record<string, string> }} job
   */
  async function send({ deliveryId, userId, template, params }) {
    const { from, ...visible } = params;
    const delivery = await read((stores) => stores.deliveries.find(deliveryId));
    if (!delivery || delivery.status !== 'queued') return 'finished';
    /** @param {'sent' | 'failed' | 'cancelled'} status @param {string | null} errorCode @param {string | null} [ticketId] */
    const finish = (status, errorCode, ticketId = null) =>
      uow.run(({ stores }) =>
        stores.deliveries.finish(deliveryId, { status, ticketId, errorCode, at: clock.now() }),
      );
    if (from && (await redis.exists(pairKey(userId, from)))) {
      await finish('cancelled', 'blocked');
      return 'cancelled';
    }
    const tokens = await identity.pushTokensOf(userId);
    if (tokens.length === 0) {
      await finish('failed', 'no_device');
      return 'failed';
    }
    const definition = /** @type {any} */ (templates.get(template));
    const rendered = definition.render(visible);
    const tickets = await push.send(
      tokens.map((/** @type {string} */ token) => ({ token, ...rendered })),
    );
    for (const t of tickets) {
      if (t.error === 'DeviceNotRegistered') await identity.removePushToken(t.token);
      if (t.ticketId)
        await redis.set(`notifications:ticket:${t.ticketId}`, t.token, 'EX', TICKET_TTL_S);
    }
    const ids = tickets.flatMap((t) => (t.ticketId ? [t.ticketId] : []));
    if (ids.length > 0) {
      await jobs.add(
        'notifications.checkReceipts',
        { ticketIds: ids },
        { delay: RECEIPT_DELAY_MS },
      );
      await finish('sent', null, ids[0]);
      return 'sent';
    }
    await finish('failed', tickets[0]?.error ?? 'unknown');
    return 'failed';
  }

  /**
   * `notifications.checkReceipts`: removes tokens whose receipt says the device is gone.
   * @param {{ ticketIds: string[] }} job
   */
  async function checkReceipts({ ticketIds }) {
    const receipts = await push.receipts(ticketIds);
    let removed = 0;
    for (const [id, error] of receipts) {
      if (error !== 'DeviceNotRegistered') continue;
      const token = await redis.get(`notifications:ticket:${id}`);
      if (token) removed += await identity.removePushToken(token);
    }
    if (removed > 0) logger.info({ removed }, 'invalid push tokens removed');
    return { removed };
  }

  /** Stops pending pushes between two users for an hour (a block). @param {string} a @param {string} b */
  const cancelBetween = (a, b) => redis.set(pairKey(a, b), '1', 'EX', CANCEL_TTL_S);

  return { queue, send, checkReceipts, cancelBetween };
}
