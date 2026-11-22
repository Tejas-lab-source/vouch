// @ts-check
import { randomUUID } from 'node:crypto';
import { startTestStorage, TEST_STORAGE } from '@vouch/config/test/containers';
import { io as connect } from 'socket.io-client';
import { createAdminAccount } from '../../../scripts/admin-create.js';
import { createAdminCrypto } from '../../../src/modules/admin/adapters/crypto/node-crypto.js';
import { hotp, stepAt } from '../../../src/modules/admin/domain/totp.js';
import modules from '../../../src/modules/index.js';
import { createS3Storage } from '../../../src/modules/media/adapters/storage/s3.js';
import { createLogPush } from '../../../src/modules/notifications/adapters/push/log.js';
import { createPlatform, startRole } from '../../../src/platform/boot.js';
import { loadConfig } from '../../../src/platform/config.js';
import { createLogger } from '../../../src/platform/logger.js';
import { eventually, makeKeys, startInfra, testEnv } from '../../platform/helpers.js';
import { jpegWithGps } from '../media/images.js';

export const DOMAIN = 'northfield.example.edu';
export const COLLEGE_ID = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f';
const CLUSTER_ID = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60';
export const ADMIN_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
export const WAIT_MS = 45_000;
const H = { 'x-app-version': '1.0.0' };
export const SIGNUP = {
  birthDate: '2005-01-31',
  gradYear: 2028,
  consent: { noticeVersion: 'draft', purposes: ['matching'] },
};

/**
 * The Phase 10 backend stack: Postgres, Redis and S3 storage (Testcontainers), one `all`
 * runtime listening on a random port (REST, sockets and workers), captured email, alerts and
 * pushes, a switchable content check, and admin accounts with real TOTP sign-in.
 * @param {Record<string, string>} [env]
 */
export async function startBackend(env = {}) {
  const [infra, s3] = await Promise.all([startInfra(), startTestStorage()]);
  const keys = await makeKeys({ kid: 'active-1' });
  await infra.admin`INSERT INTO platform.campus_clusters (id, name, city) VALUES (${CLUSTER_ID}, 'Test', 'Pune')`;
  await infra.admin`INSERT INTO platform.colleges (id, name, email_domains, cluster_id, city)
    VALUES (${COLLEGE_ID}, 'Northfield Institute', ${[DOMAIN]}, ${CLUSTER_ID}, 'Pune')`;
  const storage = createS3Storage({
    endpoint: s3.endpoint,
    accessKeyId: TEST_STORAGE.accessKeyId,
    secretAccessKey: TEST_STORAGE.secretAccessKey,
    bucket: TEST_STORAGE.bucket,
  });
  await eventually(
    () =>
      storage.ensureBucket().then(
        () => true,
        () => false,
      ),
    WAIT_MS,
  );
  await storage.write('uploads/warm-up', Buffer.from('x'), { contentType: 'text/plain' });

  /** @type {{ to: string, code: string }[]} */
  const mail = [];
  /** @type {{ to: string, subject: string, text: string }[]} */
  const alerts = [];
  /** @type {(import('../../../src/modules/notifications/ports.js').PushMessage & { at: number })[]} */
  const pushes = [];
  const invalidTokens = new Set();
  const moderation = { verdict: /** @type {'approve' | 'reject' | 'review'} */ ('approve') };

  const config = loadConfig(
    testEnv({
      ROLE: 'all',
      PORT: '0',
      METRICS_PORT: String(20_000 + Math.floor(Math.random() * 10_000)),
      DATABASE_URL: infra.appUrl,
      REDIS_URL: infra.redisUrl,
      JWT_SIGNING_KEYS: keys.json,
      JWT_ACTIVE_KID: keys.kid,
      R2_ENDPOINT: s3.endpoint,
      R2_ACCESS_KEY_ID: TEST_STORAGE.accessKeyId,
      R2_SECRET_ACCESS_KEY: TEST_STORAGE.secretAccessKey,
      R2_BUCKET: TEST_STORAGE.bucket,
      CDN_BASE_URL: s3.publicBaseUrl,
      ADMIN_TOTP_KEY,
      ADMIN_ALERT_EMAIL: 'moderation@example.com',
      SHUTDOWN_DRAIN_MS: '2000',
      ...env,
    }),
  );
  const logger = createLogger({ level: /** @type {any} */ (process.env.P10_LOG ?? 'silent') });
  const platform = await createPlatform({ config, logger });
  /** @type {any} */
  const app = await startRole({
    platform: /** @type {any} */ ({
      ...platform,
      overrides: {
        identity: {
          email: {
            sendOtp: async (/** @type {any} */ m) => void mail.push({ to: m.to, code: m.code }),
          },
        },
        media: {
          contentCheck: {
            check: async () => ({ verdict: moderation.verdict, reasons: [], provider: 'test' }),
          },
        },
        notifications: {
          push: createLogPush({
            logger,
            sink: (m) => void pushes.push({ ...m, at: performance.now() }),
            invalidTokens,
          }),
          email: { send: async (/** @type {any} */ m) => void alerts.push(m) },
        },
      },
    }),
    modules,
    listen: true,
  });
  const url = `http://127.0.0.1:${app.http.server.address().port}`;
  let n = 0;

  /** @param {string} token */
  const auth = (token) => ({ ...H, authorization: `Bearer ${token}` });

  /**
   * An HTTP call through Fastify's inject.
   * @param {string} method @param {string} path
   * @param {{ token?: string, body?: unknown, headers?: Record<string, string> }} [opts]
   */
  async function call(method, path, { token, body, headers = {} } = {}) {
    const response = await app.http.inject({
      method,
      url: path,
      headers: {
        ...H,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' || method === 'DELETE'
          ? { 'idempotency-key': `k-${++n}-${Date.now()}` }
          : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: /** @type {any} */ (body) } : {}),
    });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  }

  /**
   * Signs up through OTP. Returns the tokens, public id and internal id.
   * @param {{ email?: string, verification?: 'id_card', collegeId?: string }} [opts]
   */
  async function signUp(opts = {}) {
    const email = opts.email ?? `p10-${++n}-${randomUUID().slice(0, 8)}@${DOMAIN}`;
    const extra = opts.verification ? { verification: opts.verification } : {};
    const otp = await call('POST', '/v1/auth/otp', {
      body: { email, turnstileToken: 'dev', ...extra },
    });
    if (otp.status !== 200) throw new Error(`otp ${otp.status} ${JSON.stringify(otp.body)}`);
    const code = mail.filter((m) => m.to === email.toLowerCase()).at(-1)?.code;
    const verified = await call('POST', '/v1/auth/verify', {
      body: {
        email,
        code,
        device: { platform: 'ios' },
        signup: { ...SIGNUP, ...(opts.collegeId ? { collegeId: opts.collegeId } : {}) },
        ...extra,
      },
    });
    if (verified.status !== 200) {
      throw new Error(`verify ${verified.status} ${JSON.stringify(verified.body)}`);
    }
    const [row] =
      await infra.admin`SELECT id FROM identity.users WHERE public_id = ${verified.body.user.userId}`;
    return {
      email,
      token: /** @type {string} */ (verified.body.tokens.accessToken),
      refreshToken: /** @type {string} */ (verified.body.tokens.refreshToken),
      publicId: /** @type {string} */ (verified.body.user.userId),
      id: /** @type {string} */ (row.id),
      status: verified.body.user.status,
    };
  }

  /** A fresh access token for a user id (the test signing key). @param {string} id */
  const tokenFor = (id) => keys.sign({ sub: id, sid: randomUUID() });

  /**
   * Uploads one photo through the real presign → PUT → confirm path.
   * @param {string} token
   */
  async function uploadPhoto(token) {
    const bytes = await jpegWithGps({ width: 800, height: 1000 });
    const created = await call('POST', '/v1/media/uploads', {
      token,
      body: { contentType: 'image/jpeg', sizeBytes: bytes.length },
    });
    if (created.status !== 201) throw new Error(`upload ${created.status}`);
    const put = await fetch(created.body.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: bytes,
    });
    if (put.status !== 200) throw new Error(`put ${put.status}`);
    await call('POST', `/v1/media/uploads/${created.body.uploadId}/confirm`, { token, body: {} });
    return /** @type {string} */ (created.body.uploadId);
  }

  /** @param {string} uploadId @param {string} status */
  const uploadReaches = (uploadId, status) =>
    eventually(async () => {
      const [row] = await infra.admin`SELECT status FROM media.uploads WHERE id = ${uploadId}`;
      return row?.status === status ? row : null;
    }, WAIT_MS);

  /**
   * A complete, visible profile: details plus two approved photos.
   * @param {{ token: string }} user
   * @param {{ name?: string, gender?: number, interestedIn?: number[] }} [details]
   */
  async function completeProfile(user, details = {}) {
    const patched = await call('PATCH', '/v1/me/profile', {
      token: user.token,
      body: {
        name: details.name ?? 'Asha',
        gender: details.gender ?? 0,
        interestedIn: details.interestedIn ?? [0, 1, 2],
      },
    });
    if (patched.status !== 200)
      throw new Error(`profile ${patched.status} ${JSON.stringify(patched.body)}`);
    moderation.verdict = 'approve';
    for (const id of [await uploadPhoto(user.token), await uploadPhoto(user.token)]) {
      await uploadReaches(id, 'approved');
    }
    await eventually(async () => {
      const profile = await call('GET', '/v1/me/profile', { token: user.token });
      return profile.body?.status === 'active' ? profile : null;
    }, WAIT_MS);
  }

  /** A connected socket for a user. @param {string} token */
  async function socket(token) {
    const s = connect(url, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
    });
    await new Promise((resolve, reject) => {
      s.once('connect', () => resolve(undefined));
      s.once('connect_error', reject);
    });
    return s;
  }

  /** Registers a push token on the user's current device. @param {string} token @param {string} pushToken */
  const registerPush = (token, pushToken) =>
    call('POST', '/v1/devices', { token, body: { pushToken, platform: 'ios' } });

  /**
   * Two users who matched through the real swipe flow (each served to the other).
   * @param {any} a @param {any} b
   */
  async function match(a, b) {
    const redis = app.platform.redis.command;
    await redis.sadd(`discovery:served:${a.id}`, b.id);
    await redis.sadd(`discovery:served:${b.id}`, a.id);
    await call('POST', '/v1/swipes', {
      token: a.token,
      body: { swipeId: randomUUID(), targetId: b.publicId, direction: 'like' },
    });
    const liked = await call('POST', '/v1/swipes', {
      token: b.token,
      body: { swipeId: randomUUID(), targetId: a.publicId, direction: 'like' },
    });
    if (!liked.body?.matched) throw new Error(`no match ${JSON.stringify(liked.body)}`);
    const matchId = /** @type {string} */ (liked.body.matchId);
    await eventually(
      async () =>
        (await infra.admin`SELECT 1 FROM chat.conversations WHERE id = ${matchId}`).length === 1,
      WAIT_MS,
    );
    return matchId;
  }

  const adminCrypto = createAdminCrypto({
    totpKey: Buffer.from(ADMIN_TOTP_KEY, 'base64'),
    emailHmacSecret: config.EMAIL_HMAC_SECRET,
  });
  /** @type {Map<string, number>} */
  const lastStep = new Map();

  /**
   * Creates a staff account with the real script function. Returns a `login` that computes the
   * current TOTP code (waiting for a fresh step when the last one was used).
   * @param {'moderator' | 'admin'} role
   */
  async function createStaff(role) {
    const email = `${role}-${++n}@staff.example.com`;
    const password = `correct horse battery ${n}`;
    const { id, secret } = await createAdminAccount({
      db: app.platform.db,
      crypto: adminCrypto,
      newId: app.platform.newId,
      email,
      name: `${role} ${n}`,
      role,
      password,
      now: new Date(),
    });
    /** The current code; a code is accepted once, so this waits for the next step if needed. */
    const code = async () => {
      let step = stepAt(new Date());
      while (step <= (lastStep.get(id) ?? -1)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        step = stepAt(new Date());
      }
      lastStep.set(id, step);
      return hotp(adminCrypto.hmacSha1, secret, step);
    };
    const login = async () => {
      const res = await call('POST', '/v1/admin/auth/login', {
        body: { email, password, totp: await code() },
      });
      if (res.status !== 200)
        throw new Error(`admin login ${res.status} ${JSON.stringify(res.body)}`);
      return /** @type {string} */ (res.body.accessToken);
    };
    return { id, email, password, secret, code, login };
  }

  /** Audit entries, oldest first. */
  const auditRows = () =>
    infra.admin`SELECT action, target_type, target_id, details FROM admin.audit_log ORDER BY created_at, id`;

  return {
    infra,
    s3,
    keys,
    app,
    url,
    mail,
    alerts,
    pushes,
    invalidTokens,
    moderation,
    auth,
    call,
    signUp,
    tokenFor,
    uploadPhoto,
    uploadReaches,
    completeProfile,
    socket,
    registerPush,
    match,
    createStaff,
    auditRows,
    stop: async () => {
      await app?.stop(10_000).catch(() => {});
      await Promise.all([infra.stop(), s3.stop()]);
    },
  };
}

/**
 * Collects a socket's events of one name.
 * @param {any} socket @param {string} event
 */
export function collect(socket, event) {
  /** @type {any[]} */
  const seen = [];
  socket.on(event, (/** @type {any} */ payload) => seen.push(payload));
  return seen;
}
