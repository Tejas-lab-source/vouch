// @ts-check
import { ServiceError } from '@vouch/contracts';
import { createIdGenerator } from '../../../src/platform/ids.js';
import { createIdentityCrypto } from '../../../src/modules/identity/adapters/crypto/node-crypto.js';

export const COLLEGE = {
  id: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f',
  clusterId: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60',
  emailDomains: ['northfield.example.edu'],
};
export const NOW = new Date('2026-11-21T10:00:00Z');

/**
 * In-memory identity dependencies for use-case tests. Everything is inspectable.
 * @param {{ codes?: string[], limiter?: 'ok' | 'down' | 'limited', otpDown?: boolean }} [options]
 */
export function fakeDeps({ codes = ['123456'], limiter = 'ok', otpDown = false } = {}) {
  let nowMs = NOW.getTime();
  /** A clock tests can move forward with `advance(ms)`. */
  const clock = { now: () => new Date(nowMs) };
  /** @param {number} ms */
  const advance = (ms) => {
    nowMs += ms;
  };
  const real = createIdentityCrypto({ emailHmacSecret: 'x'.repeat(32) });
  let codeIndex = 0;
  const state = {
    users: /** @type {Map<string, any>} */ (new Map()),
    sessions: /** @type {Map<string, any>} */ (new Map()),
    devices: /** @type {Map<string, any>} */ (new Map()),
    consents: /** @type {any[]} */ ([]),
    bannedEmails: /** @type {Map<string, any>} */ (new Map()),
    otp: /** @type {Map<string, { codeHash: string, attempts: number }>} */ (new Map()),
    sent: /** @type {{ to: string, code: string }[]} */ ([]),
    events: /** @type {{ name: string, payload: any }[]} */ ([]),
    limiterCalls: /** @type {any[]} */ ([]),
  };

  /** @type {import('../../../src/modules/identity/ports.js').IdentityStores} */
  const stores = {
    users: {
      findByEmailHmac: async (h) =>
        [...state.users.values()].find((u) => u.emailHmac.equals(h)) ?? null,
      findById: async (id) => state.users.get(id) ?? null,
      findManyByIds: async (ids) => ids.map((id) => state.users.get(id)).filter(Boolean),
      findManyByPublicIds: async (publicIds) =>
        [...state.users.values()].filter((u) => publicIds.includes(u.publicId)),
      insert: async (u) => void state.users.set(u.id, { ...u, deletedAt: null }),
      markDeleted: async (id, at) =>
        void Object.assign(state.users.get(id), { status: 'deleted', deletedAt: at }),
      setStatus: async (id, status) => void Object.assign(state.users.get(id), { status }),
      deletedBefore: async (cutoff, limit) =>
        [...state.users.values()]
          .filter((u) => u.status === 'deleted' && u.deletedAt < cutoff)
          .slice(0, limit),
    },
    sessions: {
      insert: async (s) =>
        void state.sessions.set(s.id, { ...s, replacedBy: null, revokedAt: null }),
      findByTokenHashForUpdate: async (h) =>
        [...state.sessions.values()].find((s) => s.tokenHash.equals(h)) ?? null,
      findById: async (id) => state.sessions.get(id) ?? null,
      findByIdForUpdate: async (id) => state.sessions.get(id) ?? null,
      markRotated: async (id, replacedBy, at) =>
        void Object.assign(state.sessions.get(id), { replacedBy, revokedAt: at }),
      revokeFamily: async (familyId, at) => revokeWhere((s) => s.familyId === familyId, at),
      revokeAllForUser: async (userId, at) => revokeWhere((s) => s.userId === userId, at),
      revokeAllForDevice: async (deviceId, at) => revokeWhere((s) => s.deviceId === deviceId, at),
    },
    devices: {
      insert: async (d) =>
        void state.devices.set(d.id, {
          ...d,
          createdAt: d.at,
          lastSeenAt: d.at,
          revokedAt: null,
          pushToken: null,
        }),
      listActive: async (userId) =>
        [...state.devices.values()].filter((d) => d.userId === userId && !d.revokedAt),
      findForUser: async (id, userId) =>
        state.devices.get(id)?.userId === userId ? state.devices.get(id) : null,
      revoke: async (id, at) => void Object.assign(state.devices.get(id), { revokedAt: at }),
      setPushToken: async (id, pushToken) =>
        void Object.assign(state.devices.get(id), { pushToken }),
      touch: async (id, at) => void Object.assign(state.devices.get(id), { lastSeenAt: at }),
      pushTokensOf: async (userId) =>
        [...state.devices.values()]
          .filter((d) => d.userId === userId && !d.revokedAt && d.pushToken)
          .map((d) => d.pushToken),
      clearPushToken: async (token) => {
        const holders = [...state.devices.values()].filter((d) => [token].includes(d.pushToken));
        for (const d of holders) d.pushToken = null;
        return holders.length;
      },
    },
    bannedEmails: {
      insert: async (b) => void state.bannedEmails.set(b.banId, b),
      removeByBan: async (banId) => void state.bannedEmails.delete(banId),
      isBanned: async (emailHmac, now) =>
        [...state.bannedEmails.values()].some(
          (b) => b.emailHmac.equals(emailHmac) && (!b.expiresAt || b.expiresAt > now),
        ),
    },
    consents: {
      insert: async (c) => void state.consents.push(c),
      listForUser: async (userId) =>
        state.consents
          .filter((c) => c.userId === userId)
          .map((c) => ({
            noticeVersion: c.noticeVersion,
            purposes: c.purposes,
            grantedAt: c.at,
            withdrawnAt: null,
          })),
    },
  };

  /** @param {(s: any) => boolean} match @param {Date} at */
  function revokeWhere(match, at) {
    let n = 0;
    for (const s of state.sessions.values())
      if (match(s) && !s.revokedAt) {
        s.revokedAt = at;
        n += 1;
      }
    return n;
  }

  const down = () => {
    throw new Error('redis down');
  };

  /** @type {import('../../../src/modules/identity/ports.js').IdentityDeps} */
  const deps = {
    useCase: /** @type {any} */ (
      (/** @type {string} */ _name, /** @type {any} */ handler) => handler
    ),
    uow: {
      run: (fn) =>
        fn(
          /** @type {any} */ ({
            tx: null,
            stores,
            emit: async (/** @type {any} */ event, /** @type {unknown} */ payload) => {
              state.events.push({ name: event.name, payload: event.payload.parse(payload) });
              return state.events.length;
            },
          }),
        ),
    },
    read: (fn) => fn(stores),
    otpStore: {
      save: async (key, codeHash) =>
        otpDown ? down() : void state.otp.set(key, { codeHash, attempts: 0 }),
      get: async (key) => (otpDown ? down() : (state.otp.get(key) ?? null)),
      addFailedAttempt: async (key) => {
        const record = state.otp.get(key);
        if (!record) return Number.MAX_SAFE_INTEGER;
        record.attempts += 1;
        return record.attempts;
      },
      consume: async (key) => state.otp.delete(key),
    },
    colleges: { all: async () => [COLLEGE] },
    crypto: { ...real, randomCode: () => codes[codeIndex++ % codes.length] ?? '000000' },
    tokens: {
      issueAccessToken: async ({ userId, sessionId }) => ({
        token: `access:${userId}:${sessionId}`,
        expiresAt: new Date(NOW.getTime() + 900_000),
      }),
    },
    email: { sendOtp: async ({ to, code }) => void state.sent.push({ to, code }) },
    captcha: { verify: async (token) => token !== 'bad-captcha' },
    rateLimiter: {
      hit: async (limits, options) => {
        state.limiterCalls.push({ limits, options });
        if (limiter === 'down' && options?.failClosed)
          throw new ServiceError('TEMPORARILY_UNAVAILABLE');
        if (limiter === 'limited') throw new ServiceError('RATE_LIMITED');
      },
    },
    limits: {
      otpEmail15m: 3,
      otpEmailDay: 10,
      otpIpHour: 300,
      otpDeviceHour: 5,
      verifyIp15m: 300,
      refreshSessionHour: 60,
      refreshReuseGraceMs: 30_000,
    },
    clock,
    newId: createIdGenerator({ clock }),
    privacyNoticeVersion: '2026-11',
    idCardFallback: true,
    exporters: new Map(),
  };
  return { deps, state, advance };
}

export const SIGNUP = {
  birthDate: '2005-01-31',
  gradYear: 2028,
  consent: { noticeVersion: '2026-11', purposes: ['matching'] },
};
export const CTX = { actor: null, ip: '203.0.113.7' };
