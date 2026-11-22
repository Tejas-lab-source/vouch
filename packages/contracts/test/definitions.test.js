// @ts-check
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  defineEndpoint,
  defineEvent,
  ENDPOINTS,
  ERROR_STATUS,
  EVENT_NAME,
  EVENTS,
  GENDER,
  Message,
} from '../src/index.js';

const base = {
  id: 'testEndpoint',
  module: 'test',
  auth: /** @type {const} */ ('user'),
  summary: 'test',
  response: { status: 200, schema: z.strictObject({}) },
};

describe('endpoint definitions', () => {
  it('every path is under /v1 and every id and route is unique', () => {
    expect(ENDPOINTS.length).toBe(47);
    for (const endpoint of ENDPOINTS) expect(endpoint.path.startsWith('/v1/')).toBe(true);
    expect(new Set(ENDPOINTS.map((e) => e.id)).size).toBe(ENDPOINTS.length);
    expect(new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`)).size).toBe(ENDPOINTS.length);
  });

  it('every POST documents its idempotency key and every error code has a status', () => {
    for (const endpoint of ENDPOINTS) {
      if (endpoint.method === 'POST') expect(endpoint.idempotency).not.toBe('none');
      for (const code of endpoint.errors) expect(Object.hasOwn(ERROR_STATUS, code)).toBe(true);
    }
  });

  it('refuses a POST without an idempotency key', () => {
    expect(() =>
      defineEndpoint({ ...base, method: 'POST', path: '/v1/things', idempotency: 'none' }),
    ).toThrow(/idempotency/);
  });

  it('refuses path params that do not match the params schema', () => {
    expect(() => defineEndpoint({ ...base, method: 'GET', path: '/v1/things/{id}' })).toThrow(
      /params/,
    );
  });

  it('refuses body idempotency on a field the body does not have', () => {
    expect(() =>
      defineEndpoint({
        ...base,
        method: 'POST',
        path: '/v1/things',
        idempotency: 'body',
        idempotencyField: 'thingId',
        body: z.strictObject({ name: z.string() }),
      }),
    ).toThrow(/idempotencyField/);
  });

  it('refuses unknown error codes', () => {
    expect(() =>
      defineEndpoint({
        ...base,
        method: 'GET',
        path: '/v1/things',
        errors: /** @type {any} */ (['TEAPOT']),
      }),
    ).toThrow();
  });
});

describe('events', () => {
  it('defines the 15 v1 events, all named noun.verb.vN', () => {
    expect(Object.keys(EVENTS).sort()).toEqual(
      [
        'deck.served.v1',
        'match.created.v1',
        'match.unmatched.v1',
        'message.created.v1',
        'photo.approved.v1',
        'photo.rejected.v1',
        'photo.uploaded.v1',
        'profile.updated.v1',
        'report.created.v1',
        'user.banned.v1',
        'user.blocked.v1',
        'user.created.v1',
        'user.deleted.v1',
        'user.unbanned.v1',
        'verification.decided.v1',
      ].sort(),
    );
    for (const name of Object.keys(EVENTS)) expect(name).toMatch(EVENT_NAME);
  });

  it('refuses a badly named event', () => {
    expect(() =>
      defineEvent({
        name: 'userCreated',
        producer: 'identity',
        description: 'x',
        payload: z.strictObject({}),
      }),
    ).toThrow(/noun\.verb\.vN/);
  });

  it('never carries a message body in message.created.v1', () => {
    expect(Object.keys(EVENTS['message.created.v1'].payload.shape)).not.toContain('body');
  });
});

describe('owner decisions encoded in the contracts', () => {
  it('gender codes are 0 woman, 1 man, 2 non-binary', () => {
    expect(GENDER).toEqual({ WOMAN: 0, MAN: 1, NON_BINARY: 2 });
  });

  it('a message is identified by (conversationId, seq) with no separate id', () => {
    expect(Object.keys(Message.shape)).not.toContain('id');
    expect(Object.keys(Message.shape)).toEqual(expect.arrayContaining(['conversationId', 'seq']));
  });

  it('the message.send ack is { ok: true, clientMsgId, seq, createdAt } or { ok: false, error }', () => {
    const ack = CLIENT_EVENTS['message.send'].ack;
    const createdAt = '2026-11-21T10:00:00Z';
    const clientMsgId = '3b241101-e2bb-4255-8caf-4136c566a962';
    expect(ack.parse({ ok: true, clientMsgId, seq: 1, createdAt })).toEqual({
      ok: true,
      clientMsgId,
      seq: 1,
      createdAt,
    });
    expect(
      ack.safeParse({ ok: false, error: { code: 'BLOCKED', message: 'Blocked', requestId: 'r' } })
        .success,
    ).toBe(true);
  });

  it('documents that SIGNUP_DETAILS_REQUIRED does not consume the code', () => {
    const verify = ENDPOINTS.find((e) => e.id === 'verifyOtp');
    expect(verify?.description).toMatch(/NOT consumed/);
    expect(verify?.description).toMatch(/does NOT count as a failed attempt/);
  });

  it('documents the refresh cookie attributes', () => {
    const refresh = ENDPOINTS.find((e) => e.id === 'refreshTokens');
    expect(refresh?.description).toMatch(/Secure/);
    expect(refresh?.description).toMatch(/SameSite=Strict/);
    expect(refresh?.description).toMatch(/Path=\/v1\/auth\/refresh/);
  });
});
