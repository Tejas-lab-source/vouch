// @ts-check
import { describe, expect, it } from 'vitest';
import { messageFilterSteps } from '../../../src/modules/chat/application/filters.js';
import { makeSend } from '../../../src/modules/chat/application/send.js';
import { closeNotices } from '../../../src/modules/chat/domain/closing.js';
import { countLinks, linkRule } from '../../../src/modules/chat/domain/messages.js';

const LOW = '01936f3e-8a4b-7c2d-9e1f-00000000000a';
const HIGH = '01936f3e-8a4b-7c2d-9e1f-00000000000b';
const C = { userLow: LOW, userHigh: HIGH };
const none = { blockers: [], deleted: [], banned: [] };

describe('closing notices (moderation is never revealed)', () => {
  it('an ordinary unmatch tells both "unmatched"', () => {
    expect(Object.fromEntries(closeNotices(C, none))).toEqual({
      [LOW]: 'unmatched',
      [HIGH]: 'unmatched',
    });
  });

  it('a block: the blocker is told "blocked", the blocked person exactly what an unmatch says', () => {
    const notices = closeNotices(C, { ...none, blockers: [LOW] });
    expect(notices.get(LOW)).toBe('blocked');
    expect(notices.get(HIGH)).toBe(closeNotices(C, none).get(HIGH));
  });

  it('a ban: the other person is told "unmatched", like an unmatch; the banned user "banned"', () => {
    const notices = closeNotices(C, { ...none, banned: [HIGH] });
    expect(notices.get(LOW)).toBe('unmatched');
    expect(notices.get(HIGH)).toBe('banned');
  });

  it('a deletion: the other person is told "deleted", the deleted user nothing', () => {
    const notices = closeNotices(C, { ...none, deleted: [LOW] });
    expect(Object.fromEntries(notices)).toEqual({ [HIGH]: 'deleted' });
  });

  it('two blocks: both are told "blocked"', () => {
    expect(Object.fromEntries(closeNotices(C, { ...none, blockers: [LOW, HIGH] }))).toEqual({
      [LOW]: 'blocked',
      [HIGH]: 'blocked',
    });
  });
});

describe('links', () => {
  it('counts URLs, www addresses and bare domains, without double counting', () => {
    expect(countLinks('hello there')).toBe(0);
    expect(countLinks('see https://example.com/x and http://a.b')).toBe(2);
    expect(countLinks('www.example.org is nice')).toBe(1);
    expect(countLinks('ping me on example.com or vouch.app')).toBe(2);
    expect(countLinks('https://www.example.com')).toBe(1);
    expect(countLinks('e.g. 3.5 stars, a.m. or p.m.')).toBe(0);
  });

  it('no links in the first 3 messages; at most 2 per message after that', () => {
    const limits = { maxPerMessage: 2, freeAfter: 3 };
    expect(linkRule({ links: 0, senderPriorMessages: 0 }, limits)).toBeNull();
    expect(linkRule({ links: 1, senderPriorMessages: 2 }, limits)).toMatch(/first 3 messages/);
    expect(linkRule({ links: 2, senderPriorMessages: 3 }, limits)).toBeNull();
    expect(linkRule({ links: 3, senderPriorMessages: 10 }, limits)).toMatch(/at most 2 links/);
    expect(
      linkRule({ links: 1, senderPriorMessages: 0 }, { maxPerMessage: 2, freeAfter: 0 }),
    ).toBeNull();
  });
});

describe('message filter steps', () => {
  const input = { conversationId: 'c', senderId: LOW, recipientId: HIGH, kind: 'text', body: 'hi' };
  /** @param {{ prior?: number, blocked?: boolean }} [o] */
  const steps = ({ prior = 5, blocked = false } = {}) =>
    messageFilterSteps({
      countBySender: async () => prior,
      isBlocked: async () => blocked,
      limits: { maxPerMessage: 2, freeAfter: 3 },
    });
  /** @param {any[]} list @param {string} id */
  const step = (list, id) => list.find((s) => s.id === id);

  it('length: 1–1,000 characters', async () => {
    const s = step(steps(), 'chat.length');
    expect(await s.run(input)).toEqual({ allow: true, body: 'hi' });
    expect(await s.run({ ...input, body: 'x'.repeat(1001) })).toMatchObject({
      allow: false,
      code: 'MESSAGE_REJECTED',
    });
  });

  it('link limiter: a readable MESSAGE_REJECTED reason', async () => {
    const early = await step(steps({ prior: 1 }), 'chat.linkLimiter').run({
      ...input,
      body: 'https://x.com',
    });
    expect(early).toEqual({
      allow: false,
      code: 'MESSAGE_REJECTED',
      reason: 'Links can be shared after your first 3 messages in a conversation.',
    });
    expect(
      await step(steps(), 'chat.linkLimiter').run({ ...input, body: 'https://x.com' }),
    ).toMatchObject({ allow: true });
  });

  it('block check: refused as a closed conversation, never as a block', async () => {
    expect(await step(steps({ blocked: true }), 'chat.blockCheck').run(input)).toEqual({
      allow: false,
      code: 'CONVERSATION_CLOSED',
    });
  });
});

describe('send: the closed check under the row lock', () => {
  it('refuses a send when the conversation closes after the pre-checks but before the lock', async () => {
    const open = { id: 'c1', userLow: LOW, userHigh: HIGH, closedAt: null };
    /** @type {unknown[]} */
    const inserted = [];
    /** @type {unknown[]} */
    const emitted = [];
    const deps = /** @type {any} */ ({
      rateLimiter: { hit: async () => {} },
      presence: { isOnline: async () => false },
      sockets: { emitToUser: (/** @type {unknown[]} */ ...args) => emitted.push(args) },
      pipelines: { collect: async () => [{ value: { allow: true } }] },
      settings: { messagesPerMinute: 60 },
      clock: { now: () => new Date() },
      memberConversation: async () => open,
      publicIdsOf: async () => new Map(),
      uow: {
        run: (/** @type {any} */ fn) =>
          fn({
            emit: async () => {},
            stores: {
              // Closed by an unmatch that committed between the pre-check and this lock.
              conversations: {
                findForUpdate: async () => ({ ...open, closedAt: new Date() }),
                nextSeq: async () => 1,
              },
              messages: {
                byClientId: async () => null,
                insert: async (/** @type {unknown} */ m) => inserted.push(m),
              },
            },
          }),
      },
    });
    const { send } = makeSend(deps);
    await expect(
      send(
        { conversationId: 'c1', clientMsgId: 'm1', kind: 'text', body: 'hi' },
        { actor: { userId: LOW } },
      ),
    ).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' });
    expect(inserted).toEqual([]);
    expect(emitted).toEqual([]);
  });
});
