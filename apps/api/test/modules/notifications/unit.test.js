// @ts-check
import { describe, expect, it } from 'vitest';
import { createExpoPush } from '../../../src/modules/notifications/adapters/push/expo.js';
import {
  inQuietHours,
  isValidTimeZone,
  localMinute,
} from '../../../src/modules/notifications/domain/quiet-hours.js';
import { V1_TEMPLATES } from '../../../src/modules/notifications/domain/templates.js';

describe('quiet hours', () => {
  // 2026-11-22T17:30:00Z is 23:00 in Asia/Kolkata (UTC+5:30).
  const at = new Date('2026-11-22T17:30:00Z');

  it('reads the local minute in the user’s time zone', () => {
    expect(localMinute(at, 'Asia/Kolkata')).toBe(23 * 60);
    expect(localMinute(at, 'UTC')).toBe(17 * 60 + 30);
  });

  it('a window that wraps midnight covers late night and early morning', () => {
    const quiet = { startMinute: 22 * 60, endMinute: 7 * 60 };
    expect(inQuietHours(quiet, 'Asia/Kolkata', at)).toBe(true);
    expect(inQuietHours(quiet, 'Asia/Kolkata', new Date('2026-11-22T01:00:00Z'))).toBe(true); // 06:30
    expect(inQuietHours(quiet, 'Asia/Kolkata', new Date('2026-11-22T02:00:00Z'))).toBe(false); // 07:30
  });

  it('a same-day window, none, and an empty window', () => {
    expect(
      inQuietHours({ startMinute: 900, endMinute: 1000 }, 'UTC', new Date('2026-11-22T15:30:00Z')),
    ).toBe(true);
    expect(
      inQuietHours({ startMinute: 900, endMinute: 1000 }, 'UTC', new Date('2026-11-22T17:00:00Z')),
    ).toBe(false);
    expect(inQuietHours(null, 'UTC', at)).toBe(false);
    expect(inQuietHours({ startMinute: 60, endMinute: 60 }, 'UTC', at)).toBe(false);
  });

  it('validates time zone names', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('templates never carry a body, a name or an internal id', () => {
  it.each(V1_TEMPLATES)('$name', (template) => {
    const secret = 'SECRET-MESSAGE-BODY';
    const rendered = template.render({
      matchId: 'm-1',
      conversationId: 'c-1',
      count: '3',
      from: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f',
      body: secret,
      name: 'Asha',
    });
    const text = JSON.stringify(rendered);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('Asha');
    expect(text).not.toContain('01936f3e');
    expect(rendered.title.length).toBeGreaterThan(0);
  });

  it('the digest shows a count', () => {
    const digest = /** @type {any} */ (V1_TEMPLATES.find((t) => t.name === 'likes.digest'));
    expect(digest.render({ count: '1' }).body).toBe('Someone liked your profile.');
    expect(digest.render({ count: '4' }).body).toBe('4 people liked your profile.');
    expect(digest.render({ count: '250' }).body).toBe('99+ people liked your profile.');
  });
});

describe('Expo push adapter (plain fetch)', () => {
  /** @param {(url: string, body: any) => any} reply */
  function fakeFetch(reply) {
    /** @type {{ url: string, body: any, headers: any }[]} */
    const calls = [];
    const fetchImpl = /** @type {any} */ (
      async (/** @type {string} */ url, /** @type {any} */ init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, headers: init.headers });
        return { ok: true, status: 200, json: async () => reply(url, body) };
      }
    );
    return { calls, fetchImpl };
  }

  it('sends in chunks of 100 and maps tickets in order, including DeviceNotRegistered', async () => {
    const { calls, fetchImpl } = fakeFetch((_url, body) => ({
      data: body.map((/** @type {any} */ m) =>
        m.to.endsWith('bad]')
          ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: `t-${m.to}` },
      ),
    }));
    const push = createExpoPush({ accessToken: 'expo-token', fetchImpl });
    const messages = Array.from({ length: 250 }, (_, i) => ({
      token: i === 7 ? 'ExponentPushToken[bad]' : `ExponentPushToken[${i}]`,
      title: 't',
      body: 'b',
      data: { type: 'message.new' },
    }));
    const tickets = await push.send(messages);
    expect(calls.map((c) => c.body.length)).toEqual([100, 100, 50]);
    expect(calls[0]?.headers.authorization).toBe('Bearer expo-token');
    expect(tickets).toHaveLength(250);
    expect(tickets[7]).toEqual({
      token: 'ExponentPushToken[bad]',
      ticketId: null,
      error: 'DeviceNotRegistered',
    });
    expect(tickets[8]?.ticketId).toBe('t-ExponentPushToken[8]');
  });

  it('reads receipts and reports their errors', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      data: {
        a: { status: 'ok' },
        b: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      },
    }));
    const receipts = await createExpoPush({ fetchImpl }).receipts(['a', 'b']);
    expect(receipts).toEqual(
      new Map([
        ['a', null],
        ['b', 'DeviceNotRegistered'],
      ]),
    );
  });

  it('a non-2xx answer throws (the job retries)', async () => {
    const fetchImpl = /** @type {any} */ (
      async () => ({ ok: false, status: 503, json: async () => ({}) })
    );
    await expect(
      createExpoPush({ fetchImpl }).send([{ token: 'x', title: 't', body: 'b', data: {} }]),
    ).rejects.toThrow(/503/);
  });
});
