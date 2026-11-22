// @ts-check
import { ServiceError } from '@vouch/contracts';

/**
 * Logout, device listing, remote device sign-out and push-token registration.
 * @param {import('../ports.js').IdentityDeps} deps
 */
export function makeDeviceUseCases({ useCase, uow, read, clock }) {
  /** @param {import('../../../platform/use-case.js').CallContext} ctx */
  const actor = (ctx) => /** @type {import('../../../platform/auth.js').Principal} */ (ctx.actor);

  const logout = useCase(
    'identity.logout',
    async (_input, ctx) => {
      const { sessionId } = actor(ctx);
      await uow.run(async ({ stores }) => {
        const session = sessionId ? await stores.sessions.findById(sessionId) : null;
        if (session) await stores.sessions.revokeFamily(session.familyId, clock.now());
      });
      return { loggedOut: /** @type {const} */ (true) };
    },
    { idempotent: true },
  );

  const listDevices = useCase('identity.listDevices', async (_input, ctx) => {
    const { userId, sessionId } = actor(ctx);
    return read(async (stores) => {
      const current = sessionId ? await stores.sessions.findById(sessionId) : null;
      const devices = await stores.devices.listActive(userId);
      return {
        items: devices.map((device) => ({
          id: device.id,
          platform: device.platform,
          appVersion: device.appVersion,
          createdAt: device.createdAt.toISOString(),
          lastSeenAt: device.lastSeenAt.toISOString(),
          current: device.id === current?.deviceId,
        })),
      };
    });
  });

  const revokeDevice = useCase(
    'identity.revokeDevice',
    /** @param {{ id: string }} input */
    async (input, ctx) => {
      const { userId } = actor(ctx);
      await uow.run(async ({ stores }) => {
        const device = await stores.devices.findForUser(input.id, userId);
        if (!device) throw new ServiceError('NOT_FOUND');
        if (device.revokedAt) return;
        const now = clock.now();
        await stores.devices.revoke(device.id, now);
        await stores.sessions.revokeAllForDevice(device.id, now);
      });
      return { revoked: /** @type {const} */ (true) };
    },
  );

  const registerDevice = useCase(
    'identity.registerDevice',
    /** @param {{ pushToken: string, platform: 'ios' | 'android' | 'web' }} input */
    async (input, ctx) => {
      const { sessionId } = actor(ctx);
      await uow.run(async ({ stores }) => {
        const session = sessionId ? await stores.sessions.findById(sessionId) : null;
        if (!session || session.revokedAt) throw new ServiceError('UNAUTHENTICATED');
        await stores.devices.setPushToken(
          session.deviceId,
          input.pushToken,
          input.platform,
          clock.now(),
        );
      });
      return { registered: /** @type {const} */ (true) };
    },
    { idempotent: true },
  );

  return { logout, listDevices, revokeDevice, registerDevice };
}
