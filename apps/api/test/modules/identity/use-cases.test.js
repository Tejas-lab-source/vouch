// @ts-check
import { describe, expect, it } from 'vitest';
import { buildIdentityHandlers } from '../../../src/modules/identity/adapters/wiring.js';
import { createIdentityApi } from '../../../src/modules/identity/api.js';
import {
  makeOnUserBanned,
  makeOnUserUnbanned,
  makeOnVerificationDecided,
} from '../../../src/modules/identity/application/ban.js';
import {
  formatInviteCode,
  normaliseInviteCode,
} from '../../../src/modules/identity/domain/invite.js';
import { COLLEGE, CTX, fakeDeps, NOW, SIGNUP } from './fakes.js';

const EMAIL = 'Aditi+x@northfield.example.edu';
const DEVICE = { platform: /** @type {const} */ ('ios') };

/** @param {Parameters<typeof fakeDeps>[0]} [options] */
function setup(options) {
  const { deps, state, advance } = fakeDeps(options);
  return { h: buildIdentityHandlers(deps), state, deps, advance };
}

/** @param {ReturnType<typeof setup>['h']} h */
const requestCode = (h, email = EMAIL) => h.requestOtp({ email, turnstileToken: 'ok' }, CTX);

describe('requestOtp', () => {
  it('sends a code to the normalised address and always answers { sent: true }', async () => {
    const { h, state } = setup();
    expect(await requestCode(h)).toEqual({ sent: true });
    expect(state.sent).toEqual([{ to: 'aditi@northfield.example.edu', code: '123456' }]);
    expect([...state.otp.values()][0]?.codeHash).not.toContain('123456');
  });

  it('fails closed: with the rate limiter unavailable it refuses and sends nothing', async () => {
    const { h, state } = setup({ limiter: 'down' });
    await expect(requestCode(h)).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(state.sent).toEqual([]);
    expect(state.limiterCalls[0].options).toEqual({ failClosed: true });
  });

  it('fails closed: with the OTP store unavailable it refuses and sends nothing', async () => {
    const { h, state } = setup({ otpDown: true });
    await expect(requestCode(h)).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(state.sent).toEqual([]);
  });

  it('applies per-email, per-IP and per-device limits', async () => {
    const { h, state } = setup();
    await h.requestOtp(
      { email: EMAIL, turnstileToken: 'ok', deviceId: '3b241101-e2bb-4255-8caf-4136c566a962' },
      CTX,
    );
    const keys = state.limiterCalls[0].limits.map(
      (/** @type {any} */ l) => `${l.key.split(':').slice(0, 3).join(':')} ${l.max}`,
    );
    expect(keys).toEqual([
      'identity:otp:email15m 3',
      'identity:otp:emailDay 10',
      'identity:otp:ip 300',
      'identity:otp:device 5',
    ]);
  });

  it('refuses a failed captcha, a domain that is not listed exactly, and a malformed email', async () => {
    const { h } = setup();
    await expect(
      h.requestOtp({ email: EMAIL, turnstileToken: 'bad-captcha' }, CTX),
    ).rejects.toMatchObject({ code: 'CAPTCHA_FAILED' });
    await expect(requestCode(h, 'a@alumni.northfield.example.edu')).rejects.toMatchObject({
      code: 'EMAIL_DOMAIN_NOT_ALLOWED',
    });
    await expect(requestCode(h, 'nope')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('verifyOtp', () => {
  it('happy path: a new email needs signup details, keeps the code, then creates the account', async () => {
    const { h, state } = setup();
    await requestCode(h);
    await expect(
      h.verifyOtp({ email: EMAIL, code: '123456', device: DEVICE }, CTX),
    ).rejects.toMatchObject({ code: 'SIGNUP_DETAILS_REQUIRED' });
    expect([...state.otp.values()][0]?.attempts).toBe(0);

    const result = await h.verifyOtp(
      { email: EMAIL, code: '123456', device: DEVICE, signup: SIGNUP },
      CTX,
    );
    expect(result.user).toMatchObject({ status: 'active', newUser: true });
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(state.events.map((e) => e.name)).toEqual(['user.created.v1']);
    expect(state.consents).toHaveLength(1);
    expect(state.otp.size).toBe(0);
  });

  it('signs an existing user in on a new device without signup details', async () => {
    const { h, state } = setup({ codes: ['111111', '222222'] });
    await requestCode(h);
    await h.verifyOtp({ email: EMAIL, code: '111111', device: DEVICE, signup: SIGNUP }, CTX);
    await requestCode(h);
    const again = await h.verifyOtp(
      { email: EMAIL, code: '222222', device: { platform: 'web' } },
      CTX,
    );
    expect(again.user.newUser).toBe(false);
    expect(state.devices.size).toBe(2);
    expect(state.events).toHaveLength(1);
  });

  it('a wrong code counts an attempt; the 5th burns the code', async () => {
    const { h } = setup();
    await requestCode(h);
    for (let i = 0; i < 4; i += 1) {
      await expect(
        h.verifyOtp({ email: EMAIL, code: '000000', device: DEVICE }, CTX),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }
    await expect(
      h.verifyOtp({ email: EMAIL, code: '000000', device: DEVICE }, CTX),
    ).rejects.toMatchObject({ code: 'OTP_ATTEMPTS_EXHAUSTED' });
    await expect(
      h.verifyOtp({ email: EMAIL, code: '123456', device: DEVICE, signup: SIGNUP }, CTX),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('an expired (or never requested) code is refused', async () => {
    const { h } = setup();
    await expect(
      h.verifyOtp({ email: EMAIL, code: '123456', device: DEVICE }, CTX),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('refuses under-18 sign-ups and stores nothing', async () => {
    const { h, state } = setup();
    await requestCode(h);
    await expect(
      h.verifyOtp(
        {
          email: EMAIL,
          code: '123456',
          device: DEVICE,
          signup: { ...SIGNUP, birthDate: '2008-11-22' },
        },
        CTX,
      ),
    ).rejects.toMatchObject({ code: 'UNDERAGE' });
    expect(state.users.size).toBe(0);
    expect(state.consents).toHaveLength(0);
  });

  it('requires the current privacy notice version', async () => {
    const { h } = setup();
    await requestCode(h);
    await expect(
      h.verifyOtp(
        {
          email: EMAIL,
          code: '123456',
          device: DEVICE,
          signup: { ...SIGNUP, consent: { noticeVersion: 'old', purposes: ['x'] } },
        },
        CTX,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses banned accounts and accounts being deleted', async () => {
    const { h, state } = setup({ codes: ['111111', '222222', '333333'] });
    await requestCode(h);
    await h.verifyOtp({ email: EMAIL, code: '111111', device: DEVICE, signup: SIGNUP }, CTX);
    const user = [...state.users.values()][0];
    user.status = 'banned';
    await requestCode(h);
    await expect(
      h.verifyOtp({ email: EMAIL, code: '222222', device: DEVICE }, CTX),
    ).rejects.toMatchObject({ code: 'ACCOUNT_BANNED' });
    user.status = 'deleted';
    await requestCode(h);
    await expect(
      h.verifyOtp({ email: EMAIL, code: '333333', device: DEVICE }, CTX),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('sessions', () => {
  async function signedIn() {
    const s = setup();
    await requestCode(s.h);
    const result = await s.h.verifyOtp(
      { email: EMAIL, code: '123456', device: DEVICE, signup: SIGNUP },
      CTX,
    );
    const session = [...s.state.sessions.values()][0];
    const actor = {
      userId: session.userId,
      audience: /** @type {const} */ ('vouch:user'),
      mfa: false,
      sessionId: session.id,
    };
    return { ...s, tokens: result.tokens, actor };
  }

  it('refresh rotates the token; reusing the old one after the replacement was used revokes the family', async () => {
    const { h, tokens, state } = await signedIn();
    const rotated = await h.refresh({ refreshToken: tokens.refreshToken }, CTX);
    expect(rotated.tokens.refreshToken).not.toBe(tokens.refreshToken);
    const third = await h.refresh({ refreshToken: rotated.tokens.refreshToken }, CTX);
    await expect(h.refresh({ refreshToken: tokens.refreshToken }, CTX)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect([...state.sessions.values()].every((s) => s.revokedAt)).toBe(true);
    await expect(h.refresh({ refreshToken: third.tokens.refreshToken }, CTX)).rejects.toMatchObject(
      { code: 'REFRESH_TOKEN_INVALID' },
    );
  });

  it('a retry within the grace window gets a fresh pair in the same family', async () => {
    const { h, tokens, state, advance } = await signedIn();
    const lost = await h.refresh({ refreshToken: tokens.refreshToken }, CTX);
    advance(29_000);
    const retried = await h.refresh({ refreshToken: tokens.refreshToken }, CTX);
    const live = [...state.sessions.values()].filter((s) => !s.revokedAt);
    expect(live).toHaveLength(1);
    expect(new Set([...state.sessions.values()].map((s) => s.familyId)).size).toBe(1);
    // The fresh pair works; the lost replacement is retired.
    expect(
      (await h.refresh({ refreshToken: retried.tokens.refreshToken }, CTX)).tokens,
    ).toBeTruthy();
    await expect(h.refresh({ refreshToken: lost.tokens.refreshToken }, CTX)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect([...state.sessions.values()].every((s) => s.revokedAt)).toBe(true);
  });

  it('repeated retries never extend the window past 30 s from the first rotation', async () => {
    const { h, tokens, state, advance } = await signedIn();
    await h.refresh({ refreshToken: tokens.refreshToken }, CTX);
    advance(20_000);
    await h.refresh({ refreshToken: tokens.refreshToken }, CTX);
    advance(11_000);
    await expect(h.refresh({ refreshToken: tokens.refreshToken }, CTX)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect([...state.sessions.values()].every((s) => s.revokedAt)).toBe(true);
  });

  it('a retry after the grace window revokes the whole family', async () => {
    const { h, tokens, state, advance } = await signedIn();
    const rotated = await h.refresh({ refreshToken: tokens.refreshToken }, CTX);
    advance(30_001);
    await expect(h.refresh({ refreshToken: tokens.refreshToken }, CTX)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect([...state.sessions.values()].every((s) => s.revokedAt)).toBe(true);
    await expect(
      h.refresh({ refreshToken: rotated.tokens.refreshToken }, CTX),
    ).rejects.toMatchObject({ code: 'REFRESH_TOKEN_INVALID' });
  });

  it('a grace window of 0 turns retries off', async () => {
    const { tokens, deps } = await signedIn();
    const strict = buildIdentityHandlers({
      ...deps,
      limits: { ...deps.limits, refreshReuseGraceMs: 0 },
    });
    await strict.refresh({ refreshToken: tokens.refreshToken }, CTX);
    await expect(strict.refresh({ refreshToken: tokens.refreshToken }, CTX)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
  });

  it('refresh accepts the cookie and refuses missing or unknown tokens', async () => {
    const { h, tokens } = await signedIn();
    expect(
      (await h.refresh({}, { ...CTX, refreshCookie: tokens.refreshToken })).tokens,
    ).toBeTruthy();
    await expect(h.refresh({}, CTX)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_INVALID' });
    await expect(h.refresh({ refreshToken: 'unknown' }, CTX)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
  });

  it('logout revokes the session; its refresh token is then invalid (not "reused")', async () => {
    const { h, tokens, actor } = await signedIn();
    expect(await h.logout({}, { actor })).toEqual({ loggedOut: true });
    await expect(h.refresh({ refreshToken: tokens.refreshToken }, CTX)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
  });

  it('lists devices with the current one marked, and revokes another device', async () => {
    const { h, actor, state } = await signedIn();
    const list = await h.listDevices({}, { actor });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.current).toBe(true);
    await expect(
      h.revokeDevice({ id: '01936f3e-0000-7000-8000-000000000000' }, { actor }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const deviceId = /** @type {string} */ (list.items[0]?.id);
    expect(await h.revokeDevice({ id: deviceId }, { actor })).toEqual({ revoked: true });
    expect([...state.sessions.values()].every((s) => s.revokedAt)).toBe(true);
    // That was this device: its session is now signed out, so sensitive calls are refused
    // even though the access token has not expired (Phase 14).
    await expect(h.revokeDevice({ id: deviceId }, { actor })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(h.listDevices({}, { actor })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('registers a push token on the current device', async () => {
    const { h, actor, state } = await signedIn();
    await h.registerDevice({ pushToken: 'ExponentPushToken[x]', platform: 'ios' }, { actor });
    expect([...state.devices.values()][0]?.pushToken).toBe('ExponentPushToken[x]');
  });

  it('deleting the account signs out everywhere and emits user.deleted.v1 exactly once', async () => {
    const { h, actor, state } = await signedIn();
    const first = await h.deleteAccount({}, { actor });
    const second = await h.deleteAccount({}, { actor });
    expect(second).toEqual(first);
    expect(state.events.filter((e) => e.name === 'user.deleted.v1')).toHaveLength(1);
    expect(new Date(first.erasureDueBy).getTime() - Date.parse('2026-11-21T10:00:00Z')).toBe(
      30 * 24 * 3600 * 1000,
    );
    expect([...state.sessions.values()].every((s) => s.revokedAt)).toBe(true);
  });

  it('exports identity data without an email address', async () => {
    const { actor, deps } = await signedIn();
    deps.exporters.set('profiles', async () => ({ name: 'Aditi' }));
    const exported = await buildIdentityHandlers(deps).exportData({}, { actor });
    expect(Object.keys(exported.data)).toEqual(['identity', 'profiles']);
    expect(JSON.stringify(exported)).not.toContain('northfield.example.edu');
  });
});

describe('ID-card fallback and bans (Phase 10)', () => {
  const GMAIL = 'aditi@gmail.example.com';
  const ID_CARD = /** @type {const} */ ('id_card');

  it('any email may request a code with verification id_card; without it the domain must be listed', async () => {
    const { h, state } = setup();
    await expect(h.requestOtp({ email: GMAIL, turnstileToken: 'ok' }, CTX)).rejects.toMatchObject({
      code: 'EMAIL_DOMAIN_NOT_ALLOWED',
    });
    expect(
      await h.requestOtp({ email: GMAIL, turnstileToken: 'ok', verification: ID_CARD }, CTX),
    ).toEqual({
      sent: true,
    });
    expect(state.sent).toHaveLength(1);
  });

  it('is refused when the fallback is switched off', async () => {
    const { deps } = fakeDeps();
    const h = buildIdentityHandlers({ ...deps, idCardFallback: false });
    await expect(
      h.requestOtp({ email: GMAIL, turnstileToken: 'ok', verification: ID_CARD }, CTX),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('creates a pending_review account in the chosen college', async () => {
    const { h, state } = setup();
    await h.requestOtp({ email: GMAIL, turnstileToken: 'ok', verification: ID_CARD }, CTX);
    const result = await h.verifyOtp(
      {
        email: GMAIL,
        code: '123456',
        device: DEVICE,
        verification: ID_CARD,
        signup: { ...SIGNUP, collegeId: COLLEGE.id },
      },
      CTX,
    );
    expect(result.user).toMatchObject({ status: 'pending_review', newUser: true });
    const user = [...state.users.values()][0];
    expect(user).toMatchObject({ status: 'pending_review', collegeId: COLLEGE.id });
    expect(state.events.at(0)?.payload.status).toBe('pending_review');
  });

  it('needs a known college for an ID-card sign-up', async () => {
    const { h, state } = setup();
    await h.requestOtp({ email: GMAIL, turnstileToken: 'ok', verification: ID_CARD }, CTX);
    await expect(
      h.verifyOtp(
        {
          email: GMAIL,
          code: '123456',
          device: DEVICE,
          verification: ID_CARD,
          signup: { ...SIGNUP, collegeId: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e99' },
        },
        CTX,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.users.size).toBe(0);
  });

  it('a college email stays active even when id_card is sent', async () => {
    const { h } = setup();
    await requestCode(h);
    const result = await h.verifyOtp(
      { email: EMAIL, code: '123456', device: DEVICE, verification: ID_CARD, signup: SIGNUP },
      CTX,
    );
    expect(result.user.status).toBe('active');
  });

  it('ban evasion: an erased account whose ban is active cannot sign up again with that email', async () => {
    const { h, state, deps } = setup({ codes: ['111111', '222222'] });
    await requestCode(h);
    await h.verifyOtp({ email: EMAIL, code: '111111', device: DEVICE, signup: SIGNUP }, CTX);
    const user = [...state.users.values()][0];
    const stores = /** @type {any} */ (await deps.uow.run(async ({ stores: s }) => s));
    await makeOnUserBanned({ clock: deps.clock })(
      { userId: user.id, banId: 'ban-1', expiresAt: null },
      stores,
    );
    expect(user.status).toBe('banned');
    state.users.clear(); // the 30-day erasure
    await requestCode(h);
    await expect(
      h.verifyOtp({ email: EMAIL, code: '222222', device: DEVICE, signup: SIGNUP }, CTX),
    ).rejects.toMatchObject({ code: 'ACCOUNT_BANNED' });
    expect(state.users.size).toBe(0);
    expect(state.otp.size).toBe(0);
  });

  it('an expired ban no longer blocks sign-up; lifting a ban reactivates the account', async () => {
    const { h, state, deps } = setup({ codes: ['111111', '222222'] });
    await requestCode(h);
    await h.verifyOtp({ email: EMAIL, code: '111111', device: DEVICE, signup: SIGNUP }, CTX);
    const user = [...state.users.values()][0];
    const stores = /** @type {any} */ (await deps.uow.run(async ({ stores: s }) => s));
    await makeOnUserBanned({ clock: deps.clock })(
      { userId: user.id, banId: 'ban-2', expiresAt: '2026-11-20T00:00:00Z' },
      stores,
    );
    expect(await stores.bannedEmails.isBanned(user.emailHmac, deps.clock.now())).toBe(false);
    await makeOnUserUnbanned()({ userId: user.id, banId: 'ban-2' }, stores);
    expect(user.status).toBe('active');
    expect(state.bannedEmails.size).toBe(0);
  });

  it('an approved verification activates a pending_review account; a rejection leaves it pending', async () => {
    const { h, state, deps } = setup();
    await h.requestOtp({ email: GMAIL, turnstileToken: 'ok', verification: ID_CARD }, CTX);
    await h.verifyOtp(
      {
        email: GMAIL,
        code: '123456',
        device: DEVICE,
        verification: ID_CARD,
        signup: { ...SIGNUP, collegeId: COLLEGE.id },
      },
      CTX,
    );
    const user = [...state.users.values()][0];
    const stores = /** @type {any} */ (await deps.uow.run(async ({ stores: s }) => s));
    const api = createIdentityApi(deps);
    await expect(api.assertActive(user.id)).rejects.toMatchObject({
      code: 'ACCOUNT_PENDING_REVIEW',
    });
    await makeOnVerificationDecided()({ userId: user.id, decision: 'rejected' }, stores);
    expect(user.status).toBe('pending_review');
    await makeOnVerificationDecided()({ userId: user.id, decision: 'approved' }, stores);
    expect(user.status).toBe('active');
    await expect(api.assertActive(user.id)).resolves.toBeUndefined();
  });
});

describe('invite-only colleges (Phase 15)', () => {
  /** Stores an invite for the test college and returns its plaintext. */
  async function invite(
    /** @type {ReturnType<typeof setup>} */ { deps },
    /** @type {{ maxUses?: number | null, expiresAt?: Date | null, collegeId?: string }} */ opts = {},
  ) {
    const code = formatInviteCode(new Uint8Array(16).map((_, i) => i * 7 + 3));
    await deps.read((stores) =>
      stores.inviteCodes.insert({
        id: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e99',
        codeHash: deps.crypto.hashToken(/** @type {string} */ (normaliseInviteCode(code))),
        collegeId: opts.collegeId ?? COLLEGE.id,
        label: 'test batch',
        maxUses: opts.maxUses === undefined ? 1 : opts.maxUses,
        expiresAt: opts.expiresAt ?? null,
        at: new Date(),
      }),
    );
    return code;
  }
  const verify = (
    /** @type {ReturnType<typeof setup>['h']} */ h,
    /** @type {string | undefined} */ inviteCode,
    email = EMAIL,
  ) =>
    h.verifyOtp(
      {
        email,
        code: '123456',
        device: DEVICE,
        signup: { ...SIGNUP, ...(inviteCode ? { inviteCode } : {}) },
      },
      CTX,
    );

  it('needs a code; a missing or wrong one keeps the OTP so the client can retry', async () => {
    const t = setup({ inviteOnly: true });
    const code = await invite(t);
    await requestCode(t.h);
    await expect(verify(t.h, undefined)).rejects.toMatchObject({ code: 'INVITE_CODE_REQUIRED' });
    await expect(verify(t.h, 'AAAA-AAAA-AAAA-AAAA')).rejects.toMatchObject({
      code: 'INVITE_CODE_INVALID',
    });
    await expect(verify(t.h, 'not a code')).rejects.toMatchObject({
      code: 'INVITE_CODE_INVALID',
    });
    expect(t.state.otp.size).toBe(1);
    expect(t.state.users.size).toBe(0);
    // Lowercase, without hyphens: still the same code.
    const result = await verify(t.h, code.replaceAll('-', '').toLowerCase());
    expect(result.user).toMatchObject({ status: 'active', newUser: true });
    const [user] = [...t.state.users.values()];
    expect(user.inviteCodeId).toBe('01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e99');
    expect([...t.state.inviteCodes.values()][0].uses).toBe(1);
  });

  it('refuses a used-up, expired or other-college code; existing users never need one', async () => {
    const t = setup({ inviteOnly: true, codes: ['123456'] });
    const code = await invite(t, { maxUses: 1 });
    await requestCode(t.h);
    await verify(t.h, code);
    // Used up.
    await requestCode(t.h, 'second@northfield.example.edu');
    await expect(verify(t.h, code, 'second@northfield.example.edu')).rejects.toMatchObject({
      code: 'INVITE_CODE_INVALID',
    });
    // The first user signs in again without a code.
    await requestCode(t.h);
    const again = await t.h.verifyOtp({ email: EMAIL, code: '123456', device: DEVICE }, CTX);
    expect(again.user.newUser).toBe(false);

    const expired = setup({ inviteOnly: true });
    const old = await invite(expired, { expiresAt: new Date(NOW.getTime() - 1000) });
    await requestCode(expired.h);
    await expect(verify(expired.h, old)).rejects.toMatchObject({ code: 'INVITE_CODE_INVALID' });

    const elsewhere = setup({ inviteOnly: true });
    const other = await invite(elsewhere, { collegeId: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e00' });
    await requestCode(elsewhere.h);
    await expect(verify(elsewhere.h, other)).rejects.toMatchObject({
      code: 'INVITE_CODE_INVALID',
    });
  });

  it('a college that is not invite-only ignores the code', async () => {
    const t = setup();
    await requestCode(t.h);
    const result = await verify(t.h, 'AAAA-AAAA-AAAA-AAAA');
    expect(result.user.newUser).toBe(true);
    expect([...t.state.users.values()][0].inviteCodeId).toBeNull();
  });
});

describe('invite code format', () => {
  it('formats 80 random bits as XXXX-XXXX-XXXX-XXXX in Crockford base32 and normalises input', () => {
    const code = formatInviteCode(new Uint8Array(16).fill(255));
    expect(code).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    expect(normaliseInviteCode(' zzzz zzzz-zzzz-zzzz ')).toBe('Z'.repeat(16));
    expect(normaliseInviteCode('OIL0-0000-0000-0000')).toBe('0110000000000000');
    expect(normaliseInviteCode('UUUU-0000-0000-0000')).toBeNull();
    expect(normaliseInviteCode('ZZZZ')).toBeNull();
    expect(() => formatInviteCode(new Uint8Array(8))).toThrow();
  });
});
