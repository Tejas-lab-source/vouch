// @ts-check
import { AdminPanel, ServiceError } from '@vouch/contracts';
import { verifyTotp } from '../domain/totp.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3600 * 1000;
const AUDIT_RETENTION_MS = 2 * 365 * DAY_MS;
const DELETION_GRACE_MS = DAY_MS;
const DELETION_EVENT = 'user.deleted.v1';

/** @param {{ at: Date, id: string }} p */
const encodeCursor = ({ at, id }) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
/** @param {string | undefined} cursor */
function decodeCursor(cursor) {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) {
    throw new ServiceError('VALIDATION_FAILED', { message: 'Invalid cursor.' });
  }
  return { at, id: /** @type {string} */ (id) };
}

/**
 * The admin backend (Phase 10, ADR 0018). Sign-in is email + password + TOTP. Every other use
 * case needs a `vouch:admin` token with MFA (checked by the use-case chain), an account that is
 * still active (checked here on every call, so disabling takes effect at once) and, for
 * admin-only actions, the `admin` role. Every action writes exactly one audit entry, after the
 * action succeeded; details never hold notes or anything personal.
 * @param {import('../ports.js').AdminDeps} deps
 */
export function makeAdmin(deps) {
  const { useCase, uow, read, crypto, tokens, rateLimiter, identity, profiles, safety } = deps;
  const { flags, sockets, panels, subscriptions, settings, clock, newId, logger } = deps;
  const moderation = safety.moderation;

  /**
   * The signed-in staff member, re-read on every call.
   * @param {any} ctx
   * @param {'moderator' | 'admin'} role  The least role allowed.
   * @returns {Promise<import('../ports.js').StaffMember>}
   */
  async function staffOf(ctx, role) {
    const staff = await read((stores) => stores.staff.findById(ctx.actor?.userId));
    if (!staff || staff.status !== 'active') throw new ServiceError('UNAUTHENTICATED');
    if (role === 'admin' && staff.role !== 'admin') throw new ServiceError('FORBIDDEN');
    return { id: staff.id, displayName: staff.displayName, role: staff.role };
  }

  /**
   * @param {any} ctx
   * @param {import('../ports.js').StaffMember} staff
   * @param {{ action: string, targetType: string, targetId: string, details?: Record<string, unknown> }} entry
   */
  const audit = (ctx, staff, entry) =>
    uow.run(({ stores }) =>
      stores.audit.insert({
        id: newId(),
        actorId: staff.id,
        details: {},
        ...entry,
        requestId: ctx.requestId ?? null,
        createdAt: clock.now(),
      }),
    );

  /**
   * A read-only admin use case.
   * @template I, O
   * @param {string} name
   * @param {'moderator' | 'admin'} role
   * @param {(input: I, staff: import('../ports.js').StaffMember) => Promise<O>} run
   */
  const reader = (name, role, run) =>
    useCase(
      `admin.${name}`,
      /** @param {I} input */ async (input, ctx) => run(input, await staffOf(ctx, role)),
      { authz: 'admin' },
    );

  /**
   * An admin action: runs, then audits.
   * @template I, O
   * @param {string} name
   * @param {'moderator' | 'admin' | ((input: I) => 'moderator' | 'admin')} role
   * @param {(input: I, staff: import('../ports.js').StaffMember) => Promise<{ result: O, audit: { action: string, targetType: string, targetId: string, details?: Record<string, unknown> } }>} run
   */
  const action = (name, role, run) =>
    useCase(
      `admin.${name}`,
      /** @param {I} input */
      async (input, ctx) => {
        const staff = await staffOf(ctx, typeof role === 'function' ? role(input) : role);
        const outcome = await run(input, staff);
        await audit(ctx, staff, outcome.audit);
        return outcome.result;
      },
      { authz: 'admin' },
    );

  /** @param {string} publicId */
  async function userIdOf(publicId) {
    const [user] = await identity.getUsersByPublicIds([publicId]);
    if (!user) throw new ServiceError('NOT_FOUND');
    return user;
  }

  // --- Sign-in --------------------------------------------------------------------------

  const login = useCase(
    'admin.login',
    /** @param {{ email: string, password: string, totp: string }} input */
    async (input, ctx) => {
      const ip = ctx.ip ?? 'unknown';
      if (settings.ipAllowlist.length > 0 && !settings.ipAllowlist.includes(ip)) {
        throw new ServiceError('IP_NOT_ALLOWED');
      }
      const emailHmac = crypto.hmacEmail(input.email);
      await rateLimiter.hit(
        [
          { key: `admin:login:ip:${ip}`, max: 20, windowMs: 15 * MINUTE_MS },
          {
            key: `admin:login:email:${emailHmac.toString('hex')}`,
            max: 5,
            windowMs: 15 * MINUTE_MS,
          },
        ],
        { failClosed: true },
      );
      const staff = await read((stores) => stores.staff.findByEmailHmac(emailHmac));
      // The password is always checked (also for unknown accounts) so timing reveals nothing.
      const passwordOk = await crypto.verifyPassword(input.password, staff?.passwordHash ?? null);
      const refused = () => {
        logger.warn({ reason: 'admin login refused' }, 'admin login refused');
        return new ServiceError('UNAUTHENTICATED', {
          message: 'The email, password or code is wrong.',
        });
      };
      if (!staff || !passwordOk || staff.status !== 'active' || !staff.mfaEnabledAt) {
        throw refused();
      }
      const now = clock.now();
      const step = verifyTotp(crypto.decryptSecret(staff.totpSecretEnc), input.totp, now, crypto);
      // A code is accepted once: its step must be newer than the last one used.
      if (
        step === null ||
        !(await uow.run(({ stores }) => stores.staff.useTotpStep(staff.id, step, now)))
      ) {
        throw refused();
      }
      const member = { id: staff.id, displayName: staff.displayName, role: staff.role };
      const { token, expiresAt } = await tokens.sign(member);
      await audit(ctx, member, { action: 'admin.login', targetType: 'admin', targetId: staff.id });
      return {
        accessToken: token,
        expiresAt: expiresAt.toISOString(),
        admin: { displayName: staff.displayName, role: staff.role },
      };
    },
    { authz: 'public' },
  );

  // --- Panels, users, deletions ---------------------------------------------------------

  const listPanels = reader('listPanels', 'moderator', async (_input, staff) => ({
    // Parsed through the contract so defaults (field kinds, action flags) are filled in.
    items: panels.filter((p) => p.roles.includes(staff.role)).map((p) => AdminPanel.parse(p)),
  }));

  const getUser = reader(
    'getUser',
    'moderator',
    /** @param {{ userId: string }} input */ async ({ userId }) => {
      const user = await userIdOf(userId);
      const [profileStatus, college, facts] = await Promise.all([
        profiles.statusOf(user.id),
        read((stores) => stores.platform.collegeName(user.collegeId)),
        moderation.userFacts(user.id),
      ]);
      return {
        userId: user.publicId,
        status: user.status,
        profileStatus,
        collegeName: college ?? 'Unknown college',
        createdAt: user.createdAt.toISOString(),
        ...facts,
      };
    },
  );

  const listOverdueDeletions = reader('listOverdueDeletions', 'admin', async () => {
    const expected = subscriptions.get(DELETION_EVENT) ?? [];
    const cutoff = new Date(clock.now().getTime() - DELETION_GRACE_MS);
    const deleted = await identity.deletedBefore(cutoff, 500);
    const done = await read((stores) =>
      stores.platform.completedDeletions(deleted.map((/** @type {any} */ u) => u.id)),
    );
    const finished = new Set(done.map((/** @type {any} */ r) => `${r.userId}:${r.module}`));
    return {
      items: deleted.flatMap((/** @type {any} */ u) => {
        const pending = expected.filter((m) => !finished.has(`${u.id}:${m}`));
        return pending.length === 0
          ? []
          : [
              {
                userId: u.publicId,
                deletedAt: u.deletedAt.toISOString(),
                pendingConsumers: pending,
              },
            ];
      }),
    };
  });

  const unblock = action(
    'unblock',
    'admin',
    /** @param {{ userId: string, otherUserId: string, note: string }} input */
    async ({ userId, otherUserId }) => {
      const [blocker, blocked] = [await userIdOf(userId), await userIdOf(otherUserId)];
      const result = await safety.unblock(
        { blockerId: blocker.id, blockedId: blocked.id },
        { actor: { audience: 'vouch:admin', mfa: true } },
      );
      return {
        result,
        audit: {
          action: 'block.remove',
          targetType: 'user',
          targetId: userId,
          details: { otherUserId, removed: result.unblocked },
        },
      };
    },
  );

  // --- Reports, photos, verification, bans ----------------------------------------------

  const listReports = reader(
    'listReports',
    'moderator',
    /** @param {any} q */ (q) => moderation.listReports(q),
  );
  const getReport = reader(
    'getReport',
    'moderator',
    /** @param {{ id: string }} input */ ({ id }) => moderation.getReport(id),
  );
  const actOnReport = action(
    'actOnReport',
    /** @param {any} input */ (input) => (input.action === 'ban' ? 'admin' : 'moderator'),
    /** @param {{ id: string, action: any, note: string, banExpiresAt?: string }} input */
    async ({ id, ...body }, staff) => ({
      result: await moderation.actOnReport(id, body, staff.id),
      audit: {
        action: `report.${body.action}`,
        targetType: 'report',
        targetId: id,
        details: body.banExpiresAt ? { banExpiresAt: body.banExpiresAt } : {},
      },
    }),
  );

  const listPhotoReviews = reader(
    'listPhotoReviews',
    'moderator',
    /** @param {any} q */ (q) => moderation.listPhotoReviews(q),
  );
  const decidePhoto = action(
    'decidePhoto',
    'moderator',
    /** @param {{ id: string, decision: 'approve' | 'reject' }} input */
    async ({ id, decision }) => ({
      result: await moderation.decidePhoto(id, { decision }),
      audit: { action: `photo.${decision}`, targetType: 'photo', targetId: id },
    }),
  );

  const listVerificationReviews = reader(
    'listVerificationReviews',
    'moderator',
    /** @param {any} q */ (q) => moderation.listVerificationReviews(q),
  );
  const decideVerification = action(
    'decideVerification',
    'moderator',
    /** @param {{ id: string, decision: 'approve' | 'reject', reason?: string }} input */
    async ({ id, ...body }, staff) => ({
      result: await moderation.decideVerification(id, body, staff.id),
      audit: { action: `verification.${body.decision}`, targetType: 'verification', targetId: id },
    }),
  );

  const listBans = reader(
    'listBans',
    'moderator',
    /** @param {any} q */ (q) => moderation.listBans(q),
  );
  const createBan = action(
    'createBan',
    'admin',
    /** @param {{ userId: string, reason: string, expiresAt?: string }} input */
    async ({ userId, reason, expiresAt }, staff) => {
      const user = await userIdOf(userId);
      if (user.status === 'deleted') throw new ServiceError('NOT_FOUND');
      const ban = await moderation.createBan({
        userId: user.id,
        reason,
        expiresAt: expiresAt ?? null,
        actorId: staff.id,
      });
      return {
        result: ban,
        audit: {
          action: 'ban.create',
          targetType: 'user',
          targetId: userId,
          details: { banId: ban.banId, expiresAt: ban.expiresAt },
        },
      };
    },
  );
  const liftBan = action(
    'liftBan',
    'admin',
    /** @param {{ id: string }} input */
    async ({ id }, staff) => ({
      result: await moderation.liftBan(id, staff.id),
      audit: { action: 'ban.lift', targetType: 'ban', targetId: id },
    }),
  );

  // --- Audit log and flags --------------------------------------------------------------

  const listAuditLog = reader(
    'listAuditLog',
    'admin',
    /** @param {{ cursor?: string, limit: number, targetType?: string, targetId?: string }} q */
    async ({ cursor, limit, targetType, targetId }) => {
      const rows = await read((stores) =>
        stores.audit.list({ before: decodeCursor(cursor), limit: limit + 1, targetType, targetId }),
      );
      const page = rows.slice(0, limit);
      const names = await read((stores) =>
        stores.staff.namesOf([...new Set(page.map((/** @type {any} */ r) => r.actorId))]),
      );
      const last = page.at(-1);
      return {
        items: page.map((/** @type {any} */ r) => ({
          id: r.id,
          actorName: names.get(r.actorId) ?? 'Removed account',
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          details: r.details,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor:
          rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
      };
    },
  );

  /** @param {any} row */
  const flagView = (row) => ({
    key: row.key,
    enabled: row.enabled,
    rules: row.rules,
    updatedAt: row.updatedAt.toISOString(),
  });

  const listFlags = reader('listFlags', 'admin', async () => ({
    items: (await read((stores) => stores.flags.list())).map(flagView),
  }));

  const putFlag = action(
    'putFlag',
    'admin',
    /** @param {{ key: string, enabled: boolean, rules: unknown[] }} input */
    async ({ key, enabled, rules }) => {
      const row = await uow.run(({ stores }) => stores.flags.put(key, enabled, rules, clock.now()));
      await flags.invalidate();
      sockets.broadcast('config.changed', {});
      return {
        result: flagView(row),
        audit: {
          action: 'flag.put',
          targetType: 'flag',
          targetId: key,
          details: { enabled, rules: rules.length },
        },
      };
    },
  );

  /** `admin.retentionTick` (nightly): audit entries older than 2 years. */
  const retention = () =>
    uow.run(({ stores }) =>
      stores.audit.purge(new Date(clock.now().getTime() - AUDIT_RETENTION_MS)),
    );

  return {
    login,
    listPanels,
    getUser,
    listOverdueDeletions,
    unblock,
    listReports,
    getReport,
    actOnReport,
    listPhotoReviews,
    decidePhoto,
    listVerificationReviews,
    decideVerification,
    listBans,
    createBan,
    liftBan,
    listAuditLog,
    listFlags,
    putFlag,
    retention,
  };
}
