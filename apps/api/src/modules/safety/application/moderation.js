// @ts-check
import {
  reportCreated,
  ServiceError,
  userBanned,
  userUnbanned,
  verificationDecided,
} from '@vouch/contracts';
import {
  banActive,
  decodeCursor,
  encodeCursor,
  ERASED_PUBLIC_ID,
  isRepeatOffence,
  REPORT_ACTIONS,
  shouldAutoHide,
  SYSTEM_ACTOR_ID,
} from '../domain/reports.js';

export const REPORT_EVIDENCE = 'safety.reportEvidence';
const DAY_MS = 24 * 3600 * 1000;
const OFFENCE_WINDOW_MS = 30 * DAY_MS;
const SUBMISSION_TTL_S = 3600;
const EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

/**
 * @typedef {object} ModerationDeps
 * @property {import('../../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../../platform/uow.js').UnitOfWork<import('../ports.js').SafetyStores>} uow
 * @property {<T>(fn: (stores: import('../ports.js').SafetyStores) => Promise<T>) => Promise<T>} read
 * @property {any} identity  identity's public API
 * @property {any} profiles  profiles' public API
 * @property {any} media  media's public API
 * @property {{ collect: (name: string, input: unknown) => Promise<{ id: string, value: any }[]> }} pipelines
 * @property {{ hit: (limits: { key: string, max: number, windowMs: number }[], options?: { failClosed?: boolean }) => Promise<void> }} rateLimiter
 * @property {{ get: (key: string) => Promise<string | null>, set: (...args: any[]) => Promise<unknown> }} redis
 * @property {{ autohideReporters: number, autohideDays: number, reportsPerDay: number, rejectionsForReview: number, uploadMaxBytes: number }} settings
 * @property {{ now: () => Date }} clock
 * @property {() => string} newId
 * @property {import('pino').Logger} logger
 */

/**
 * Safety part 2 (Phase 10): reports with evidence snapshots and auto-hide, moderation actions,
 * bans, ID-card verification reviews, the photo review queue and repeat offences. User-facing
 * use cases are `report`, `createIdCardUploads` and `submitIdCard`; everything else is called by
 * the admin module, which checks the admin token and writes the audit log.
 * @param {ModerationDeps} deps
 */
export function makeModeration(deps) {
  const { useCase, uow, read, identity, profiles, media, pipelines, rateLimiter } = deps;
  const { redis, settings, clock, newId, logger } = deps;

  /** Public ids for internal ids; erased accounts get a fixed tombstone. @param {readonly string[]} ids */
  async function publicIdsOf(ids) {
    const unique = [...new Set(ids)].filter((id) => id !== SYSTEM_ACTOR_ID);
    const users = unique.length > 0 ? await identity.getUsersByIds(unique) : [];
    const map = new Map(users.map((/** @type {any} */ u) => [u.id, u.publicId]));
    return (/** @type {string} */ id) => map.get(id) ?? ERASED_PUBLIC_ID;
  }

  /** @param {string} publicId */
  async function userByPublicId(publicId) {
    const [user] = await identity.getUsersByPublicIds([publicId]);
    if (!user || user.status === 'deleted') throw new ServiceError('NOT_FOUND');
    return user;
  }

  /** Evidence for a new report. @param {{ reporterId: string, targetId: string, context: 'profile' | 'chat', conversationId: string | null }} input */
  async function evidenceFor(input) {
    const card = await profiles.getCard(input.targetId);
    if (input.context !== 'chat') return { card, messages: [] };
    const results = await pipelines.collect(REPORT_EVIDENCE, input);
    // Fail closed: a chat report needs its messages (chat contributes the step).
    if (results.length === 0) throw new ServiceError('TEMPORARILY_UNAVAILABLE');
    if (results.some((r) => r.value.refuse)) throw new ServiceError('NOT_A_MEMBER');
    return { card, messages: results.flatMap((r) => r.value.messages).slice(-20) };
  }

  /**
   * Files a report in the moderation queue and, after commit, hides the target's profile when
   * enough distinct people reported it recently.
   * @param {{ reporterId: string, targetId: string, context: 'profile' | 'chat', reason: string, note: string | null, evidence: any }} report
   */
  async function fileReport(report) {
    const id = newId();
    const now = clock.now();
    await uow.run(async ({ stores, emit }) => {
      await stores.reports.insert({ id, ...report, createdAt: now });
      await emit(reportCreated, {
        reportId: id,
        reporterId: report.reporterId,
        targetId: report.targetId,
        context: report.context,
        reason: report.reason,
        createdAt: now.toISOString(),
      });
    });
    const since = new Date(now.getTime() - settings.autohideDays * DAY_MS);
    const reporters = await read((stores) =>
      stores.reports.distinctReportersSince(report.targetId, since, SYSTEM_ACTOR_ID),
    );
    if (shouldAutoHide(reporters, settings.autohideReporters)) {
      await profiles.hide(report.targetId).catch((/** @type {unknown} */ err) => {
        logger.error({ err, reportId: id }, 'auto-hide failed');
      });
    }
    return id;
  }

  const report = useCase(
    'safety.report',
    /** @param {{ targetId: string, context: 'profile' | 'chat', reason: string, conversationId?: string, note?: string }} input */
    async (input, ctx) => {
      const reporterId = /** @type {string} */ (ctx.actor?.userId);
      await identity.assertActive(reporterId);
      await rateLimiter.hit([
        { key: `safety:reports:${reporterId}`, max: settings.reportsPerDay, windowMs: DAY_MS },
      ]);
      const target = await userByPublicId(input.targetId);
      if (target.id === reporterId) {
        throw new ServiceError('VALIDATION_FAILED', { message: 'You cannot report yourself.' });
      }
      const { card, messages } = await evidenceFor({
        reporterId,
        targetId: target.id,
        context: input.context,
        conversationId: input.conversationId ?? null,
      });
      const reportId = await fileReport({
        reporterId,
        targetId: target.id,
        context: input.context,
        reason: input.reason,
        note: input.note ?? null,
        evidence: { card, messages, note: input.note ?? null },
      });
      return { reportId, status: /** @type {const} */ ('open') };
    },
    { idempotent: true },
  );

  /** @param {any} row @param {(id: string) => string} pub */
  const summary = (row, pub) => ({
    reportId: row.id,
    status: row.status,
    context: row.context,
    reason: row.reason,
    reporterId: pub(row.reporterId),
    targetId: pub(row.targetId),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  });

  /** @param {string} id */
  async function getReport(id) {
    const row = await read((stores) => stores.reports.find(id));
    if (!row) throw new ServiceError('NOT_FOUND');
    const pub = await publicIdsOf([row.reporterId, row.targetId]);
    const prior = await read((stores) => stores.reports.countAgainst(row.targetId, row.id));
    return {
      ...summary(row, pub),
      evidence: {
        card: row.evidence.card ?? null,
        messages: row.evidence.messages ?? [],
        note: row.evidence.note ?? null,
      },
      priorReportsAgainstTarget: prior,
    };
  }

  /** @param {{ status: string, cursor?: string, limit: number }} query */
  async function listReports({ status, cursor, limit }) {
    const rows = await read((stores) =>
      stores.reports.list({ status, after: decodeCursor(cursor), limit: limit + 1 }),
    );
    const page = rows.slice(0, limit);
    const pub = await publicIdsOf(
      page.flatMap((/** @type {any} */ r) => [r.reporterId, r.targetId]),
    );
    const last = page.at(-1);
    return {
      items: page.map((/** @type {any} */ r) => summary(r, pub)),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
    };
  }

  /** @param {any} ban @param {(id: string) => string} pub */
  const banView = (ban, pub) => ({
    banId: ban.id,
    userId: pub(ban.userId),
    reason: ban.reason,
    createdAt: ban.createdAt.toISOString(),
    expiresAt: ban.expiresAt?.toISOString() ?? null,
    liftedAt: ban.liftedAt?.toISOString() ?? null,
  });

  /**
   * Bans a user (emits `user.banned.v1`: identity revokes sessions, matching ends matches,
   * chat closes conversations, discovery hides them). CONFLICT when a ban is already active.
   * @param {{ userId: string, reason: string, expiresAt: string | null, actorId: string }} input
   */
  async function createBan({ userId, reason, expiresAt, actorId }) {
    const now = clock.now();
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && expiry <= now) {
      throw new ServiceError('VALIDATION_FAILED', { message: 'The ban must end in the future.' });
    }
    const id = newId();
    const ban = await uow.run(async ({ stores, emit }) => {
      const current = await stores.bans.activeFor(userId);
      if (current) {
        if (banActive(current, now)) throw new ServiceError('CONFLICT');
        // An expired ban not yet lifted by the nightly job is lifted now.
        await stores.bans.lift(current.id, SYSTEM_ACTOR_ID, now);
        await emit(userUnbanned, { userId, banId: current.id, liftedAt: now.toISOString() });
      }
      await stores.bans.insert({
        id,
        userId,
        reason,
        createdBy: actorId,
        createdAt: now,
        expiresAt: expiry,
      });
      await emit(userBanned, {
        userId,
        banId: id,
        expiresAt: expiry?.toISOString() ?? null,
        bannedAt: now.toISOString(),
      });
      return { id, userId, reason, createdAt: now, expiresAt: expiry, liftedAt: null };
    });
    return banView(ban, await publicIdsOf([userId]));
  }

  /**
   * Lifts a ban (idempotent; emits `user.unbanned.v1` once). Matches stay ended.
   * @param {string} banId @param {string} actorId
   */
  async function liftBan(banId, actorId) {
    const now = clock.now();
    const ban = await uow.run(async ({ stores, emit }) => {
      const found = await stores.bans.findForUpdate(banId);
      if (!found) throw new ServiceError('NOT_FOUND');
      if (found.liftedAt) return found;
      await stores.bans.lift(banId, actorId, now);
      await emit(userUnbanned, { userId: found.userId, banId, liftedAt: now.toISOString() });
      return { ...found, liftedAt: now };
    });
    return banView(ban, await publicIdsOf([ban.userId]));
  }

  /** @param {{ active: boolean, cursor?: string, limit: number }} query */
  async function listBans({ active, cursor, limit }) {
    const rows = await read((stores) =>
      stores.bans.list({
        active,
        before: decodeCursor(cursor),
        limit: limit + 1,
        now: clock.now(),
      }),
    );
    const page = rows.slice(0, limit);
    const pub = await publicIdsOf(page.map((/** @type {any} */ b) => b.userId));
    const last = page.at(-1);
    return {
      items: page.map((/** @type {any} */ b) => banView(b, pub)),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
    };
  }

  /**
   * Resolves an open report (CONFLICT when already closed). Moderation actions apply to the
   * target: warn records the warning only (shown to the user in a later phase); hide and unhide
   * change the profile; ban creates a ban.
   * @param {string} id
   * @param {{ action: 'dismiss' | 'warn' | 'hide' | 'unhide' | 'ban', note: string, banExpiresAt?: string }} input
   * @param {string} actorId
   */
  async function actOnReport(id, input, actorId) {
    const row = await read((stores) => stores.reports.find(id));
    if (!row) throw new ServiceError('NOT_FOUND');
    if (row.status !== 'open') throw new ServiceError('CONFLICT');
    if (input.action === 'hide') await profiles.hide(row.targetId);
    if (input.action === 'unhide') await profiles.unhide(row.targetId);
    if (input.action === 'ban') {
      const current = await read((stores) => stores.bans.activeFor(row.targetId));
      if (!current || !banActive(current, clock.now())) {
        await createBan({
          userId: row.targetId,
          reason: input.note,
          expiresAt: input.banExpiresAt ?? null,
          actorId,
        });
      }
    }
    await uow.run(async ({ stores }) => {
      const locked = await stores.reports.findForUpdate(id);
      if (locked?.status !== 'open') throw new ServiceError('CONFLICT');
      await stores.reports.resolve(id, {
        status: REPORT_ACTIONS.get(input.action),
        resolution: input.action,
        by: actorId,
        note: input.note,
        at: clock.now(),
      });
    });
    return getReport(id);
  }

  /** Facts for the admin user view. @param {string} userId */
  async function userFacts(userId) {
    const [received, ban] = await read(async (stores) => [
      await stores.reports.countAgainst(userId, SYSTEM_ACTOR_ID),
      await stores.bans.activeFor(userId),
    ]);
    const pub = await publicIdsOf([userId]);
    return {
      reportsReceived: received,
      activeBan: ban && banActive(ban, clock.now()) ? banView(ban, pub) : null,
    };
  }

  // --- ID-card verification -------------------------------------------------------------

  /** @param {string} userId */
  async function assertAwaitingReview(userId) {
    const user = await identity.getUser(userId);
    if (user?.status !== 'pending_review') {
      throw new ServiceError('FORBIDDEN', {
        message: 'ID-card verification is only for accounts waiting for review.',
      });
    }
    if (await read((stores) => stores.verifications.pendingFor(userId))) {
      throw new ServiceError('CONFLICT', { message: 'Your ID is already being reviewed.' });
    }
  }

  /** @param {{ contentType: string, sizeBytes: number }} file */
  const checkFile = (file) => {
    if (file.sizeBytes > settings.uploadMaxBytes) throw new ServiceError('FILE_TOO_LARGE');
    if (!EXTENSIONS.has(file.contentType)) throw new ServiceError('UNSUPPORTED_MEDIA_TYPE');
  };

  const createIdCardUploads = useCase(
    'safety.createIdCardUploads',
    /** @param {{ idCard: { contentType: string, sizeBytes: number }, selfie: { contentType: string, sizeBytes: number } }} input */
    async (input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      await assertAwaitingReview(userId);
      checkFile(input.idCard);
      checkFile(input.selfie);
      const submissionId = newId();
      const key = (/** @type {string} */ name, /** @type {string} */ type) =>
        `verification/${submissionId}/${name}.${EXTENSIONS.get(type)}`;
      const idKey = key('id', input.idCard.contentType);
      const selfieKey = key('selfie', input.selfie.contentType);
      const target = async (/** @type {string} */ k, /** @type {any} */ file) => ({
        url: await media.privateObjects.presignPut({
          key: k,
          contentType: file.contentType,
          contentLength: file.sizeBytes,
        }),
        method: /** @type {const} */ ('PUT'),
        headers: { 'content-type': file.contentType, 'content-length': String(file.sizeBytes) },
      });
      const idCard = await target(idKey, input.idCard);
      const selfie = await target(selfieKey, input.selfie);
      await redis.set(
        `safety:idcard:${submissionId}`,
        JSON.stringify({ userId, idKey, selfieKey }),
        'EX',
        SUBMISSION_TTL_S,
      );
      return {
        submissionId,
        idCard,
        selfie,
        expiresAt: new Date(clock.now().getTime() + SUBMISSION_TTL_S * 1000).toISOString(),
      };
    },
    { idempotent: true },
  );

  const submitIdCard = useCase(
    'safety.submitIdCard',
    /** @param {{ submissionId: string }} input */
    async (input, ctx) => {
      const userId = /** @type {string} */ (ctx.actor?.userId);
      const existing = await read((stores) => stores.verifications.find(input.submissionId));
      if (existing) {
        if (existing.userId !== userId) throw new ServiceError('NOT_FOUND');
        return { status: /** @type {const} */ ('pending') };
      }
      const raw = await redis.get(`safety:idcard:${input.submissionId}`);
      const submission = raw ? JSON.parse(raw) : null;
      if (!submission || submission.userId !== userId) throw new ServiceError('NOT_FOUND');
      await assertAwaitingReview(userId);
      for (const k of [submission.idKey, submission.selfieKey]) {
        if (!(await media.privateObjects.exists(k))) throw new ServiceError('UPLOAD_NOT_UPLOADED');
      }
      await uow.run(async ({ stores }) => {
        const inserted = await stores.verifications
          .insert({
            id: input.submissionId,
            userId,
            idImageKey: submission.idKey,
            selfieImageKey: submission.selfieKey,
            submittedAt: clock.now(),
          })
          .catch((/** @type {any} */ err) => {
            // One pending review per user (unique index).
            if (err?.code === '23505') throw new ServiceError('CONFLICT');
            throw err;
          });
        return inserted;
      });
      return { status: /** @type {const} */ ('pending') };
    },
  );

  /** @param {any} row @param {(id: string) => string} pub */
  const reviewView = async (row, pub) => ({
    reviewId: row.id,
    userId: pub(row.userId),
    status: row.status,
    idImageUrl: row.idImageKey ? await media.privateObjects.signedUrl(row.idImageKey) : null,
    selfieImageUrl: row.selfieImageKey
      ? await media.privateObjects.signedUrl(row.selfieImageKey)
      : null,
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  });

  /** @param {{ status: string, cursor?: string, limit: number }} query */
  async function listVerificationReviews({ status, cursor, limit }) {
    const rows = await read((stores) =>
      stores.verifications.list({ status, after: decodeCursor(cursor), limit: limit + 1 }),
    );
    const page = rows.slice(0, limit);
    const pub = await publicIdsOf(page.map((/** @type {any} */ r) => r.userId));
    const last = page.at(-1);
    return {
      items: await Promise.all(page.map((/** @type {any} */ r) => reviewView(r, pub))),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ at: last.submittedAt, id: last.id }) : null,
    };
  }

  /**
   * Approves (activates the account) or rejects (the student may submit again) a review.
   * @param {string} id
   * @param {{ decision: 'approve' | 'reject', reason?: string }} input
   * @param {string} actorId
   */
  async function decideVerification(id, input, actorId) {
    const now = clock.now();
    const row = await uow.run(async ({ stores, emit }) => {
      const found = await stores.verifications.findForUpdate(id);
      if (!found) throw new ServiceError('NOT_FOUND');
      if (found.status !== 'pending') throw new ServiceError('CONFLICT');
      const status = input.decision === 'approve' ? 'approved' : 'rejected';
      await stores.verifications.decide(id, {
        status,
        by: actorId,
        reason: input.reason ?? null,
        at: now,
      });
      await emit(verificationDecided, {
        userId: found.userId,
        reviewId: id,
        decision: status,
        decidedAt: now.toISOString(),
      });
      return { ...found, status, decidedAt: now };
    });
    return reviewView(row, await publicIdsOf([row.userId]));
  }

  // --- Photo review queue ---------------------------------------------------------------

  /** @param {{ cursor?: string, limit: number }} query */
  async function listPhotoReviews({ cursor, limit }) {
    const afterId = cursor ? Buffer.from(cursor, 'base64url').toString() : null;
    if (afterId !== null && !/^[0-9a-f-]{36}$/.test(afterId)) {
      throw new ServiceError('VALIDATION_FAILED');
    }
    const rows = await media.listInReview({ afterId, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const pub = await publicIdsOf(page.map((/** @type {any} */ r) => r.userId));
    const last = page.at(-1);
    return {
      items: page.map((/** @type {any} */ r) => ({
        photoId: r.uploadId,
        userId: pub(r.userId),
        urls: r.urls,
        reasons: [],
        flaggedAt: (r.flaggedAt ?? clock.now()).toISOString(),
      })),
      nextCursor:
        rows.length > limit && last ? Buffer.from(last.uploadId).toString('base64url') : null,
    };
  }

  /**
   * @param {string} photoId
   * @param {{ decision: 'approve' | 'reject' }} input
   */
  async function decidePhoto(photoId, input) {
    const outcome = await media.resolveReview(photoId, input.decision);
    if (outcome === 'released') throw new ServiceError('NOT_FOUND');
    if (outcome === 'finished') throw new ServiceError('CONFLICT');
    return {
      photoId,
      status: /** @type {'approved' | 'rejected'} */ (
        input.decision === 'approve' ? 'approved' : 'rejected'
      ),
    };
  }

  // --- Consumers and jobs ---------------------------------------------------------------

  /**
   * `photo.rejected.v1`: counts moderation rejections; a run of them in 30 days opens a system
   * report so staff look at the account.
   * @param {{ uploadId: string, userId: string, reason: string, rejectedAt: string }} payload
   * @param {import('../ports.js').SafetyStores} stores
   * @param {(event: any, payload: unknown) => Promise<number>} emit
   */
  async function onPhotoRejected(payload, stores, emit) {
    if (payload.reason !== 'moderation') return;
    const at = new Date(payload.rejectedAt);
    await stores.rejections.record(payload.uploadId, payload.userId, at);
    const since = new Date(clock.now().getTime() - OFFENCE_WINDOW_MS);
    const offence = isRepeatOffence({
      reason: payload.reason,
      rejectionsInWindow: await stores.rejections.countSince(payload.userId, since),
      threshold: settings.rejectionsForReview,
      alreadyOpen: await stores.reports.openSystemReportFor(payload.userId, SYSTEM_ACTOR_ID),
    });
    if (!offence) return;
    const id = newId();
    const now = clock.now();
    const evidence = {
      card: null,
      messages: [],
      note: `${settings.rejectionsForReview} or more photos rejected by moderation in 30 days.`,
    };
    await stores.reports.insert({
      id,
      reporterId: SYSTEM_ACTOR_ID,
      targetId: payload.userId,
      context: 'profile',
      reason: 'inappropriate_content',
      evidence,
      createdAt: now,
    });
    await emit(reportCreated, {
      reportId: id,
      reporterId: SYSTEM_ACTOR_ID,
      targetId: payload.userId,
      context: 'profile',
      reason: 'inappropriate_content',
      createdAt: now.toISOString(),
    });
  }

  /**
   * `safety.retentionTick` (nightly): lifts expired bans (emitting `user.unbanned.v1`), deletes
   * ID images 30 days after the decision, report evidence 1 year after close, bans 30 days
   * after they ended, and offence counts after 30 days.
   */
  async function retention() {
    const now = clock.now();
    const expired = await read((stores) => stores.bans.expired(now, 500));
    for (const ban of expired) {
      await uow.run(async ({ stores, emit }) => {
        const locked = await stores.bans.findForUpdate(ban.id);
        if (!locked || locked.liftedAt) return;
        await stores.bans.lift(ban.id, SYSTEM_ACTOR_ID, now);
        await emit(userUnbanned, {
          userId: ban.userId,
          banId: ban.id,
          liftedAt: now.toISOString(),
        });
      });
    }
    const images = await read((stores) =>
      stores.verifications.imagesDecidedBefore(new Date(now.getTime() - 30 * DAY_MS), 500),
    );
    const keys = images.flatMap((/** @type {any} */ r) =>
      [r.idImageKey, r.selfieImageKey].filter(Boolean),
    );
    await media.privateObjects.remove(keys);
    const counts = await uow.run(async ({ stores }) => {
      await stores.verifications.clearImages(images.map((/** @type {any} */ r) => r.id));
      return {
        reports: await stores.reports.purgeClosed(new Date(now.getTime() - 365 * DAY_MS)),
        bans: await stores.bans.purgeFinished(new Date(now.getTime() - 30 * DAY_MS)),
        rejections: await stores.rejections.purge(new Date(now.getTime() - OFFENCE_WINDOW_MS)),
      };
    });
    return { liftedBans: expired.length, idImages: keys.length, ...counts };
  }

  return {
    report,
    createIdCardUploads,
    submitIdCard,
    admin: {
      listReports,
      getReport,
      actOnReport,
      createBan,
      liftBan,
      listBans,
      userFacts,
      listVerificationReviews,
      decideVerification,
      listPhotoReviews,
      decidePhoto,
    },
    onPhotoRejected,
    retention,
  };
}
