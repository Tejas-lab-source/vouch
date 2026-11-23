// @ts-check
import { userDeleted } from '@vouch/contracts';
import { ERASURE_DELAY_MS } from '../domain/session.js';
import { makeSessionGuard } from './sessions.js';

/**
 * Account deletion and personal-data export (DPDP erasure and access rights).
 * @param {import('../ports.js').IdentityDeps} deps
 */
export function makeAccountUseCases({ useCase, uow, read, clock, exporters }) {
  // Deletion and export are sensitive: a revoked session's access token cannot use them.
  const { sensitive, requireLiveSession } = makeSessionGuard({ read });
  /** @param {import('../../../platform/use-case.js').CallContext} ctx */
  const userIdOf = (ctx) =>
    /** @type {import('../../../platform/auth.js').Principal} */ (ctx.actor).userId;

  /**
   * Marks the account deleted, signs out everywhere and emits `user.deleted.v1` once. Every
   * module erases its data within 30 days. Repeating the call returns the same result.
   */
  const deleteAccount = useCase('identity.deleteAccount', async (_input, ctx) => {
    const userId = userIdOf(ctx);
    // A repeat after deletion (every session is then revoked) answers the same result and
    // changes nothing, so only a first deletion needs a live session.
    const existing = await read((stores) => stores.users.findById(userId));
    if (existing?.status !== 'deleted') await requireLiveSession(ctx);
    return uow.run(async ({ stores, emit }) => {
      const user = await stores.users.findById(userId);
      const deletedAt = user?.deletedAt ?? clock.now();
      const eraseBy = new Date(deletedAt.getTime() + ERASURE_DELAY_MS);
      if (user && user.status !== 'deleted') {
        await stores.users.markDeleted(userId, deletedAt);
        await stores.sessions.revokeAllForUser(userId, deletedAt);
        await emit(userDeleted, {
          userId,
          deletedAt: deletedAt.toISOString(),
          eraseBy: eraseBy.toISOString(),
        });
      }
      return { deleted: /** @type {const} */ (true), erasureDueBy: eraseBy.toISOString() };
    });
  });

  /** Identity's own data plus every module's `exports` hook. Email is not stored, so not exported. */
  const exportData = useCase(
    'identity.exportData',
    sensitive(async (_input, ctx) => {
      const userId = userIdOf(ctx);
      const identity = await read(async (stores) => {
        const user = await stores.users.findById(userId);
        const devices = await stores.devices.listActive(userId);
        const consents = await stores.consents.listForUser(userId);
        return {
          account: user && {
            publicId: user.publicId,
            collegeId: user.collegeId,
            status: user.status,
            birthDate: user.birthDate,
            gradYear: user.gradYear,
            createdAt: user.createdAt.toISOString(),
          },
          email: 'Not stored: only a keyed hash of your college email is kept.',
          devices: devices.map((d) => ({
            platform: d.platform,
            appVersion: d.appVersion,
            createdAt: d.createdAt.toISOString(),
            lastSeenAt: d.lastSeenAt.toISOString(),
          })),
          consents: consents.map((c) => ({
            noticeVersion: c.noticeVersion,
            purposes: c.purposes,
            grantedAt: c.grantedAt.toISOString(),
            withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
          })),
        };
      });
      /** @type {[string, Record<string, unknown>][]} */
      const entries = [['identity', identity]];
      for (const [module, exporter] of exporters) {
        if (module !== 'identity') entries.push([module, await exporter(userId)]);
      }
      return { generatedAt: clock.now().toISOString(), data: Object.fromEntries(entries) };
    }),
  );

  return { deleteAccount, exportData };
}
