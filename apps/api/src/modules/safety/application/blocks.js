// @ts-check
import { ServiceError, userBlocked } from '@vouch/contracts';
import { canBlock } from '../domain/block.js';

/**
 * Blocking, and the block policy every read path uses.
 * @param {import('../ports.js').SafetyDeps} deps
 */
export function makeBlocks(deps) {
  const { useCase, uow, read, storesFor, blockCache, identity, clock, logger } = deps;

  /**
   * Loads a user's blocked set from Postgres into Redis (best-effort).
   * @param {string} userId
   * @param {import('../ports.js').SafetyStores} [stores]
   */
  async function warm(userId, stores) {
    const others = stores
      ? await stores.blocks.othersOf(userId)
      : await read((s) => s.blocks.othersOf(userId));
    await blockCache.load(userId, others).catch((err) => {
      logger.warn({ err }, 'block cache load failed');
    });
    return new Set(others);
  }

  /**
   * Everyone a user has blocked or been blocked by. Redis when loaded, else Postgres.
   * @param {string} userId
   * @param {{ tx?: import('postgres').TransactionSql }} [options]
   */
  async function blockedSet(userId, { tx } = {}) {
    const cached = await blockCache.members(userId);
    return cached ?? warm(userId, tx ? storesFor(tx) : undefined);
  }

  const blockPolicy = {
    /**
     * True when either user blocked the other. Checks Redis first, then Postgres (on `tx` if
     * given, so a caller's transaction sees its own writes).
     * @param {string} a
     * @param {string} b
     * @param {{ tx?: import('postgres').TransactionSql }} [options]
     */
    isBlocked: async (a, b, options = {}) => (await blockedSet(a, options)).has(b),
    /**
     * The subset of `ids` that `viewerId` must not see (one lookup for many candidates).
     * @param {string} viewerId
     * @param {readonly string[]} ids
     */
    blockedAmong: async (viewerId, ids) => {
      const blocked = await blockedSet(viewerId);
      return new Set(ids.filter((id) => blocked.has(id)));
    },
  };

  const block = useCase(
    'safety.block',
    /** @param {{ targetId: string }} input */
    async (input, ctx) => {
      const blockerId = /** @type {string} */ (ctx.actor?.userId);
      const [target] = await identity.getUsersByPublicIds([input.targetId]);
      if (!target || target.status === 'deleted') throw new ServiceError('NOT_FOUND');
      if (!canBlock(blockerId, target.id)) {
        throw new ServiceError('VALIDATION_FAILED', { message: 'You cannot block yourself.' });
      }
      const at = clock.now();
      try {
        await uow.run(async ({ stores, emit }) => {
          const fresh = await stores.blocks.insert(blockerId, target.id, at);
          // Redis is updated before commit, so the block holds the moment the call returns.
          // If Redis is unavailable the block fails (fails closed) rather than leaving a stale
          // set that says "not blocked".
          await blockCache.add(blockerId, target.id).catch(() => {
            throw new ServiceError('TEMPORARILY_UNAVAILABLE');
          });
          if (fresh) {
            await emit(userBlocked, {
              blockerId,
              blockedId: target.id,
              blockedAt: at.toISOString(),
            });
          }
        });
      } catch (error) {
        // The sets may now hold a pair that was never committed: drop them so they reload.
        await blockCache.forget(blockerId, target.id).catch(() => {});
        throw error;
      }
      return { blocked: /** @type {const} */ (true) };
    },
  );

  const unblock = useCase(
    'safety.unblock',
    /** @param {{ blockerId: string, blockedId: string }} input */
    async (input) => {
      const removed = await uow.run(({ stores }) =>
        stores.blocks.remove(input.blockerId, input.blockedId),
      );
      await blockCache.forget(input.blockerId, input.blockedId);
      return { unblocked: removed };
    },
    { authz: 'admin' },
  );

  const listBlocked = useCase('safety.listBlocked', async (_input, ctx) => {
    const userId = /** @type {string} */ (ctx.actor?.userId);
    const rows = await read((stores) => stores.blocks.blockedBy(userId));
    const users = await identity.getUsersByIds(rows.map((r) => r.blockedId));
    const publicIds = new Map(users.map((u) => [u.id, u.publicId]));
    return {
      items: rows.flatMap((r) => {
        const publicId = publicIds.get(r.blockedId);
        return publicId ? [{ userId: publicId, blockedAt: r.createdAt.toISOString() }] : [];
      }),
    };
  });

  /**
   * Who, of the two, has blocked the other (both, one or none). For wording notices only: the
   * blocked person is never told (ARCHITECTURE.md 11; owner decision, Phase 9).
   * @param {string} a
   * @param {string} b
   */
  const blockersBetween = (a, b) => read((stores) => stores.blocks.blockersBetween(a, b));

  return { block, unblock, listBlocked, blockPolicy, blockersBetween };
}

/**
 * Bans (the table is filled by Phase 10's moderation tools).
 * @param {Pick<import('../ports.js').SafetyDeps, 'read' | 'clock'>} deps
 */
export function makeBans({ read, clock }) {
  /** @param {readonly string[]} userIds */
  const bannedAmong = async (userIds) =>
    new Set(
      userIds.length === 0
        ? []
        : await read((stores) => stores.bans.activeAmong(userIds, clock.now())),
    );
  return {
    bannedAmong,
    /** @param {string} userId */
    isBanned: async (userId) => (await bannedAmong([userId])).has(userId),
  };
}
