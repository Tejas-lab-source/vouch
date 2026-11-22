// @ts-check
import { z } from 'zod';
import * as s from './samples.js';

/** @typedef {Record<string, { valid: unknown[], invalid: unknown[] }>} Fixtures */

/** @param {string} name @param {number} version @param {unknown} payload */
const envelope = (name, version, payload) => ({
  id: 42,
  name,
  version,
  occurredAt: s.TS,
  traceId: 'trace-1',
  payload,
});

/** Socket fixtures, keyed `socket.<event>.payload` / `socket.<event>.ack`. @type {Fixtures} */
export const socketFixtures = {
  'socket.message.send.payload': {
    valid: [{ conversationId: s.ID, clientMsgId: s.UUID4, kind: 'text', body: 'hello' }],
    invalid: [
      { conversationId: s.ID, clientMsgId: s.UUID4, kind: 'text', body: '' },
      { conversationId: s.ID, clientMsgId: s.UUID4, kind: 'text', body: 'x'.repeat(1001) },
      { conversationId: s.ID, clientMsgId: s.UUID4, kind: 'image', body: 'x' },
    ],
  },
  'socket.message.send.ack': {
    valid: [
      { ok: true, clientMsgId: s.UUID4, seq: 8, createdAt: s.TS },
      { ok: false, error: { code: 'CONVERSATION_CLOSED', message: 'Closed', requestId: 'req-2' } },
    ],
    invalid: [{ ok: true, id: s.ID, seq: 8, createdAt: s.TS }, { ok: false }],
  },
  'socket.message.read.payload': {
    valid: [{ conversationId: s.ID, seq: 3 }],
    invalid: [{ conversationId: s.ID, seq: 0 }],
  },
  'socket.message.delivered.payload': {
    valid: [{ conversationId: s.ID, seq: 3 }],
    invalid: [{ seq: 3 }],
  },
  'socket.sync.payload': {
    valid: [{ cursors: [{ conversationId: s.ID, lastSeq: 0 }] }, { cursors: [] }],
    invalid: [{ cursors: [{ conversationId: s.ID, lastSeq: -1 }] }],
  },
  'socket.sync.ack': {
    valid: [{ ok: true, messages: [s.message], truncated: false }],
    invalid: [{ ok: true, messages: [s.message] }],
  },
  'socket.message.new.payload': { valid: [s.message], invalid: [{ ...s.message, seq: 0 }] },
  'socket.match.new.payload': {
    valid: [{ matchId: s.ID, conversationId: null, user: s.card }],
    invalid: [{ matchId: s.ID, user: s.card }],
  },
  'socket.conversation.closed.payload': {
    valid: [{ conversationId: s.ID, reason: 'unmatched' }],
    invalid: [{ conversationId: s.ID, reason: 'expired' }],
  },
  'socket.config.changed.payload': { valid: [{}], invalid: [{ flags: {} }] },
};

/** Domain event envelopes, keyed `event.<name>`. @type {Fixtures} */
export const eventFixtures = {
  'event.user.created.v1': {
    valid: [
      envelope('user.created.v1', 1, {
        userId: s.ID,
        publicId: s.PUBLIC_ID,
        collegeId: s.ID,
        clusterId: s.ID2,
        birthDate: '2004-02-29',
        status: 'active',
        createdAt: s.TS,
      }),
    ],
    invalid: [envelope('user.created.v1', 2, { userId: s.ID })],
  },
  'event.user.deleted.v1': {
    valid: [envelope('user.deleted.v1', 1, { userId: s.ID, deletedAt: s.TS, eraseBy: s.TS })],
    invalid: [envelope('user.deleted.v2', 1, { userId: s.ID, deletedAt: s.TS, eraseBy: s.TS })],
  },
  'event.profile.updated.v1': {
    valid: [
      envelope('profile.updated.v1', 1, {
        userId: s.ID,
        status: 'active',
        changed: ['bio'],
        updatedAt: s.TS,
      }),
    ],
    invalid: [
      envelope('profile.updated.v1', 1, {
        userId: s.ID,
        status: 'active',
        changed: [],
        updatedAt: s.TS,
      }),
    ],
  },
  'event.photo.uploaded.v1': {
    valid: [
      envelope('photo.uploaded.v1', 1, {
        uploadId: s.ID,
        userId: s.ID2,
        rawKey: 'uploads/raw/x',
        contentType: 'image/png',
        confirmedAt: s.TS,
      }),
    ],
    invalid: [
      envelope('photo.uploaded.v1', 1, {
        uploadId: s.ID,
        userId: s.ID2,
        rawKey: 'uploads/raw/x',
        contentType: 'image/gif',
        confirmedAt: s.TS,
      }),
    ],
  },
  'event.photo.approved.v1': {
    valid: [
      envelope('photo.approved.v1', 1, {
        photoId: s.ID,
        uploadId: s.ID2,
        userId: s.ID,
        keys: { w400: 'a', w1080: 'b' },
        approvedAt: s.TS,
      }),
    ],
    invalid: [
      envelope('photo.approved.v1', 1, {
        photoId: s.ID,
        uploadId: s.ID2,
        userId: s.ID,
        keys: { w400: 'a' },
        approvedAt: s.TS,
      }),
    ],
  },
  'event.photo.rejected.v1': {
    valid: [
      envelope('photo.rejected.v1', 1, {
        photoId: null,
        uploadId: s.ID,
        userId: s.ID2,
        reason: 'not_an_image',
        rejectedAt: s.TS,
      }),
    ],
    invalid: [
      envelope('photo.rejected.v1', 1, {
        photoId: null,
        uploadId: s.ID,
        userId: s.ID2,
        reason: 'ugly',
        rejectedAt: s.TS,
      }),
    ],
  },
  'event.deck.served.v1': {
    valid: [envelope('deck.served.v1', 1, { viewerId: s.ID, targetIds: [s.ID2], servedAt: s.TS })],
    invalid: [envelope('deck.served.v1', 1, { viewerId: s.ID, targetIds: [], servedAt: s.TS })],
  },
  'event.match.created.v1': {
    valid: [
      envelope('match.created.v1', 1, {
        matchId: s.ID,
        userLow: s.ID,
        userHigh: s.ID2,
        firstLikerId: s.ID2,
        createdAt: s.TS,
      }),
    ],
    invalid: [
      envelope('match.created.v1', 1, {
        matchId: s.ID,
        userLow: s.ID,
        userHigh: s.ID2,
        createdAt: s.TS,
      }),
    ],
  },
  'event.match.unmatched.v1': {
    valid: [
      envelope('match.unmatched.v1', 1, {
        matchId: s.ID,
        userLow: s.ID,
        userHigh: s.ID2,
        unmatchedBy: null,
        unmatchedAt: s.TS,
      }),
    ],
    invalid: [{ ...envelope('match.unmatched.v1', 1, {}), occurredAt: 'yesterday' }],
  },
  'event.message.created.v1': {
    valid: [
      envelope('message.created.v1', 1, {
        conversationId: s.ID,
        seq: 1,
        senderId: s.ID,
        recipientId: s.ID2,
        kind: 'text',
        createdAt: s.TS,
      }),
    ],
    invalid: [
      envelope('message.created.v1', 1, {
        conversationId: s.ID,
        seq: 1,
        senderId: s.ID,
        recipientId: s.ID2,
        kind: 'text',
        body: 'secret',
        createdAt: s.TS,
      }),
    ],
  },
  'event.user.blocked.v1': {
    valid: [envelope('user.blocked.v1', 1, { blockerId: s.ID, blockedId: s.ID2, blockedAt: s.TS })],
    invalid: [
      envelope('user.blocked.v1', 1, { blockerId: s.PUBLIC_ID, blockedId: s.ID2, blockedAt: s.TS }),
    ],
  },
  'event.report.created.v1': {
    valid: [
      envelope('report.created.v1', 1, {
        reportId: s.ID,
        reporterId: s.ID,
        targetId: s.ID2,
        context: 'profile',
        reason: 'spam',
        createdAt: s.TS,
      }),
    ],
    invalid: [
      envelope('report.created.v1', 1, {
        reportId: s.ID,
        reporterId: s.ID,
        targetId: s.ID2,
        context: 'feed',
        reason: 'spam',
        createdAt: s.TS,
      }),
    ],
  },
  'event.user.banned.v1': {
    valid: [
      envelope('user.banned.v1', 1, {
        userId: s.ID,
        banId: s.ID2,
        expiresAt: null,
        bannedAt: s.TS,
      }),
    ],
    invalid: [
      {
        ...envelope('user.banned.v1', 1, {
          userId: s.ID,
          banId: s.ID2,
          expiresAt: null,
          bannedAt: s.TS,
        }),
        id: 0,
      },
    ],
  },
};

/** Job payloads, keyed `job.<name>`. @type {Fixtures} */
export const jobFixtures = {
  'job.discovery.buildDeck': {
    valid: [{ userId: s.ID, reason: 'refill' }],
    invalid: [{ userId: s.ID, reason: 'because' }],
  },
  'job.matching.writePasses': {
    valid: [{ passes: [{ swiperId: s.ID, targetId: s.ID2, swipedAt: s.TS }] }],
    invalid: [{ passes: [] }],
  },
  'job.matching.purgePasses': {
    valid: [{ partition: 15, olderThan: s.TS }],
    invalid: [{ partition: 16, olderThan: s.TS }],
  },
  'job.media.processImage': {
    valid: [{ uploadId: s.ID, userId: s.ID2 }],
    invalid: [{ uploadId: s.ID }],
  },
  'job.notifications.sendPush': {
    valid: [{ deliveryId: s.ID, userId: s.ID2, template: 'match.new', params: { name: 'Aditi' } }],
    invalid: [{ deliveryId: s.ID, userId: s.ID2, template: 'marketing', params: {} }],
  },
  'job.notifications.checkReceipts': {
    valid: [{ ticketIds: ['t1'] }],
    invalid: [{ ticketIds: [] }],
  },
  'job.identity.retention': {
    valid: [{ task: 'sessions', olderThan: s.TS }],
    invalid: [{ task: 'outbox', olderThan: s.TS }],
  },
  'job.platform.retention': {
    valid: [{ task: 'outbox', olderThan: s.TS }],
    invalid: [{ task: 'everything', olderThan: s.TS }],
  },
};

/** Pipeline step shapes, keyed `pipeline.<name>.input|output`. @type {Fixtures} */
export const pipelineFixtures = {
  'pipeline.discovery.candidateFilters.input': {
    valid: [{ viewer: s.candidate, candidates: [s.candidate] }],
    invalid: [{ viewer: s.candidate }],
  },
  'pipeline.discovery.candidateFilters.output': {
    valid: [{ candidates: [], removed: [{ userId: s.ID, reason: 'blocked' }] }],
    invalid: [{ candidates: [], removed: [{ userId: s.ID, reason: 'Blocked!' }] }],
  },
  'pipeline.discovery.scorers.input': {
    valid: [{ viewer: s.candidate, candidate: s.candidate }],
    invalid: [{ viewer: s.candidate, candidate: { ...s.candidate, age: 17 } }],
  },
  'pipeline.discovery.scorers.output': {
    valid: [{ score: 0.7, reason: 'recently active' }],
    invalid: [{ score: 1.5, reason: 'x' }],
  },
  'pipeline.chat.messageFilters.input': {
    valid: [{ conversationId: s.ID, senderId: s.ID, recipientId: s.ID2, kind: 'text', body: 'hi' }],
    invalid: [{ conversationId: s.ID, senderId: s.ID, kind: 'text', body: 'hi' }],
  },
  'pipeline.chat.messageFilters.output': {
    valid: [
      { allow: true, body: 'hi' },
      { allow: false, code: 'MESSAGE_REJECTED' },
    ],
    invalid: [{ allow: false, code: 'NOPE' }],
  },
  'pipeline.safety.contentChecks.input': {
    valid: [{ userId: s.ID, kind: 'photo', objectKey: 'uploads/raw/x', contentType: 'image/webp' }],
    invalid: [{ userId: s.ID, kind: 'video', objectKey: 'x', contentType: 'image/webp' }],
  },
  'pipeline.safety.contentChecks.output': {
    valid: [{ verdict: 'review', reasons: ['suggestive'], provider: 'dev' }],
    invalid: [{ verdict: 'unsure', reasons: [], provider: 'dev' }],
  },
  'pipeline.profiles.cardFields.input': { valid: [s.card], invalid: [{ ...s.card, photos: [] }] },
  'pipeline.profiles.cardFields.output': { valid: [s.card], invalid: [{ ...s.card, extra: true }] },
};

/** Common building blocks and the remaining top-level schemas. @type {Fixtures} */
export const commonFixtures = {
  ErrorEnvelope: {
    valid: [{ error: s.errorBody }, { error: { ...s.errorBody, details: { field: 'email' } } }],
    invalid: [{ error: { ...s.errorBody, code: 'TEAPOT' } }, { error: s.errorBody, stack: 'at x' }],
  },
  BaseHeaders: {
    valid: [{ 'x-app-version': '1.0.0', 'user-agent': 'x' }],
    invalid: [{}, { 'x-app-version': 'v1' }],
  },
  IdempotentHeaders: {
    valid: [{ 'x-app-version': '1.0.0', 'idempotency-key': s.UUID4 }],
    invalid: [
      { 'x-app-version': '1.0.0' },
      { 'x-app-version': '1.0.0', 'idempotency-key': 'short' },
    ],
  },
  PageQuery: { valid: [{}, { cursor: s.CURSOR, limit: '20' }], invalid: [{ cursor: 'has space' }] },
  Gender: { valid: [0, 1, 2], invalid: [3, '0'] },
  InterestedIn: { valid: [[0], [0, 1, 2]], invalid: [[], [1, 1], [0, 1, 2, 2]] },
  FlagRule: {
    valid: [{ type: 'minAppVersion', version: '1.2.0' }],
    invalid: [{ type: 'minAppVersion' }],
  },
  ConfigResponse: { valid: [s.config], invalid: [{ ...s.config, limits: undefined }] },
  SectionDefinitionSchema: {
    valid: [
      {
        type: 'prompts',
        schemaVersion: 1,
        data: z.strictObject({ answer: z.string() }),
        owner: 'profiles',
      },
    ],
    invalid: [{ type: 'prompts', schemaVersion: 1, data: {}, owner: 'profiles' }],
  },
};

/** Env samples (strings, as process.env provides them). */
const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/vouch',
  REDIS_URL: 'redis://localhost:6379',
  EMAIL_HMAC_SECRET: 'x'.repeat(32),
  JWT_SIGNING_KEYS: '[]',
  JWT_ACTIVE_KID: 'k1',
  COOKIE_SECRET: 'y'.repeat(32),
  R2_ENDPOINT: 'http://localhost:8333',
  R2_ACCESS_KEY_ID: 'vouch-local',
  R2_SECRET_ACCESS_KEY: 'vouch-local-secret',
  R2_BUCKET: 'vouch',
  CDN_BASE_URL: 'http://localhost:8333/vouch',
};

/** @type {Fixtures} */
export const envFixtures = {
  EnvSchema: {
    valid: [
      baseEnv,
      {
        ...baseEnv,
        ROLE: 'worker',
        PORT: '8080',
        DATABASE_PREPARE: 'false',
        CORS_ORIGINS: 'https://a.example.com, https://b.example.com',
      },
      {
        ...baseEnv,
        NODE_ENV: 'production',
        R2_ENDPOINT: undefined,
        R2_ACCOUNT_ID: 'acct',
        CDN_BASE_URL: 'https://cdn.example.com',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_x',
        EMAIL_FROM: 'no-reply@example.com',
        CAPTCHA_PROVIDER: 'turnstile',
        TURNSTILE_SECRET_KEY: 'ts',
        PUSH_PROVIDER: 'expo',
        MODERATION_PROVIDER: 'sightengine',
        MODERATION_API_KEY: 'mk',
      },
    ],
    invalid: [
      { ...baseEnv, DATABASE_URL: 'mysql://x' },
      { ...baseEnv, EMAIL_HMAC_SECRET: 'short' },
      { ...baseEnv, NODE_ENV: 'production' },
      { ...baseEnv, EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@example.com' },
      { ...baseEnv, R2_ENDPOINT: undefined },
      { ...baseEnv, IMAGE_WORKER_CONCURRENCY: '0' },
      { ...baseEnv, UPLOAD_MAX_BYTES: '20000000' },
      { ...baseEnv, PHOTOS_MAX: '7' },
    ],
  },
};
