// @ts-check
import { recordAudit } from '../../../platform/uow.js';
import { ServiceError, userBlocked } from '@vouch/contracts';
import { canBlock } from '../domain/block.js';

/**
 * Blocking, and the block policy every read path uses.
 * @param {import('../ports.js').SafetyDeps} deps
 */
export function makeBlocks(deps) {
  const { useCase, uow, read, storesFor, blockCache, identity, profiles, clock, logger } = deps;

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
    /**
     * The staff trail comes in `ctx.audit` (ADR 0025): the removal and its audit entry commit
     * together.
     * @param {{ blockerId: string, blockedId: string, auditTarget?: { userId: string, otherUserId: string } }} input
     */
    async (input, ctx) => {
      const removed = await uow.run(async ({ stores, emit }) => {
        const gone = await stores.blocks.remove(input.blockerId, input.blockedId);
        await recordAudit(emit, ctx.audit, {
          action: 'block.remove',
          targetType: 'user',
          targetId: input.auditTarget?.userId ?? input.blockerId,
          details: {
            otherUserId: input.auditTarget?.otherUserId ?? input.blockedId,
            removed: gone,
          },
        });
        return gone;
      });
      await blockCache.forget(input.blockerId, input.blockedId);
      return { unblocked: removed };
    },
    { authz: 'admin' },
  );

  /**
   * `DELETE /v1/blocks/{userId}`: the caller removes their own block. Only the caller's block on
   * that user is touched (a block the other person made stays). Matches and conversations ended
   * by the block are not restored.
   */
  const unblockMine = useCase(
    'safety.unblockMine',
    /** @param {{ userId: string }} input */
    async (input, ctx) => {
      // Sensitive: removing a safety protection needs a live session (Phase 14).
      await identity.requireLiveSession(ctx);
      const blockerId = /** @type {string} */ (ctx.actor?.userId);
      const [target] = await identity.getUsersByPublicIds([input.userId]);
      if (!target) return { unblocked: false };
      const removed = await uow.run(({ stores }) => stores.blocks.remove(blockerId, target.id));
      await blockCache.forget(blockerId, target.id);
      return { unblocked: removed };
    },
  );

  /** `GET /v1/me/blocks`: the caller's blocks with a display name (null when not visible). */
  const listMyBlocks = useCase('safety.listMyBlocks', async (_input, ctx) => {
    const userId = /** @type {string} */ (ctx.actor?.userId);
    const rows = await read((stores) => stores.blocks.blockedBy(userId));
    const ids = rows.map((r) => r.blockedId);
    const [users, cards] = await Promise.all([
      identity.getUsersByIds(ids),
      profiles ? profiles.getCards(ids) : Promise.resolve([]),
    ]);
    const publicIds = new Map(users.map((u) => [u.id, u.publicId]));
    const names = new Map(
      /** @type {{ userId: string, name: string }[]} */ (cards).map((c) => [c.userId, c.name]),
    );
    return {
      items: rows.flatMap((r) => {
        const publicId = publicIds.get(r.blockedId);
        return publicId
          ? [
              {
                userId: publicId,
                name: names.get(publicId) ?? null,
                blockedAt: r.createdAt.toISOString(),
              },
            ]
          : [];
      }),
    };
  });

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

  return { block, unblock, unblockMine, listBlocked, listMyBlocks, blockPolicy, blockersBetween };
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
