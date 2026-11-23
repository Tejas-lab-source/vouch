// @ts-check

/** @typedef {Record<string, (...args: any[]) => Promise<any>>} StoreGroup */

/**
 * @typedef {object} SafetyStores
 * @property {{
 *   insert(blockerId: string, blockedId: string, at: Date): Promise<boolean>,
 *   remove(blockerId: string, blockedId: string): Promise<boolean>,
 *   blockedBy(blockerId: string): Promise<{ blockedId: string, createdAt: Date }[]>,
 *   othersOf(userId: string): Promise<string[]>,
 *   exists(a: string, b: string): Promise<boolean>,
 *   blockersBetween(a: string, b: string): Promise<string[]>,
 * }} blocks  `othersOf` and `exists` are symmetric (either direction).
 * @property {{ activeAmong(userIds: readonly string[], now: Date): Promise<string[]>, [more: string]: (...args: any[]) => Promise<any> }} bans
 * @property {StoreGroup} reports  Phase 10 (see adapters/pg/stores.js).
 * @property {StoreGroup} verifications  Phase 10.
 * @property {StoreGroup} rejections  Phase 10.
 * @property {StoreGroup} erasure  Phase 10.
 */

/**
 * Redis cache of each user's blocked-in-either-direction set, `safety:blocked:{uid}`. A set is
 * authoritative only once it has been loaded from Postgres (it then holds a marker member);
 * otherwise callers fall back to SQL.
 * @typedef {object} BlockCache
 * @property {(a: string, b: string) => Promise<void>} add  Adds the pair to both sets; throws if Redis is down.
 * @property {(a: string, b: string) => Promise<void>} forget  Drops both sets (they reload).
 * @property {(userId: string) => Promise<Set<string> | null>} members  Null when not loaded or unavailable.
 * @property {(userId: string, others: readonly string[]) => Promise<void>} load
 */

/**
 * A moderation API (Rekognition in production, ADR 0013).
 * @typedef {object} ModerationProvider
 * @property {string} name
 * @property {(image: Uint8Array) => Promise<import('./domain/moderation.js').ModerationFindings>} inspect
 */

/**
 * @typedef {object} SafetyDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<SafetyStores>} uow
 * @property {<T>(fn: (stores: SafetyStores) => Promise<T>) => Promise<T>} read
 * @property {(tx: import('postgres').TransactionSql) => SafetyStores} storesFor  Stores on a caller's transaction.
 * @property {BlockCache} blockCache
 * @property {{ getUsersByPublicIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string, status: string }[]>, getUsersByIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string }[]> }} identity
 * @property {any} [profiles]  profiles' public API (Phase 10)
 * @property {any} [media]  media's public API (Phase 10)
 * @property {any} [pipelines]
 * @property {any} [rateLimiter]
 * @property {any} [redis]
 * @property {() => string} [newId]
 * @property {any} [settings]
 * @property {ModerationProvider} moderation
 * @property {import('./domain/moderation.js').ModerationThresholds} thresholds
 * @property {{ now: () => Date }} clock
 * @property {import('pino').Logger} logger
 */

export {};
