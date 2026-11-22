// @ts-check

/**
 * @typedef {object} MatchRecord
 * @property {string} id
 * @property {string} userLow
 * @property {string} userHigh
 * @property {Date} createdAt
 * @property {Date | null} unmatchedAt
 * @property {Date | null} anonymisedAt
 */

/**
 * @typedef {object} MatchingStores
 * @property {{
 *   insertLike(swiperId: string, targetId: string, at: Date): Promise<boolean>,
 *   pairState(me: string, targetId: string, userLow: string, userHigh: string): Promise<{ reverseLike: boolean, previouslyUnmatched: boolean }>,
 *   insertPasses(passes: readonly { swiperId: string, targetId: string, swipedAt: string }[]): Promise<number>,
 *   likesInCount(userId: string): Promise<number>,
 *   forUser(userId: string): Promise<{ targetId: string, direction: number, createdAt: Date }[]>,
 *   removeForUser(userId: string): Promise<number>,
 *   purgePasses(partition: number, olderThan: Date, limit: number): Promise<number>,
 * }} swipes
 * @property {{
 *   createOrGet(match: { id: string, userLow: string, userHigh: string, at: Date }): Promise<{ match: MatchRecord, created: boolean }>,
 *   findPair(userLow: string, userHigh: string): Promise<MatchRecord | null>,
 *   find(id: string): Promise<MatchRecord | null>,
 *   findForUpdate(id: string): Promise<MatchRecord | null>,
 *   setUnmatched(id: string, at: Date): Promise<void>,
 *   activeForUser(userId: string, after: { createdAt: Date, id: string } | null, limit: number): Promise<MatchRecord[]>,
 *   allForUser(userId: string): Promise<MatchRecord[]>,
 *   anonymise(id: string, userLow: string, userHigh: string, at: Date): Promise<void>,
 * }} matches
 */

/**
 * Passes waiting to be written (Redis). The pending set per swiper lets the deck builder
 * exclude them before they reach Postgres.
 * @typedef {object} PassBuffer
 * @property {(pass: { swiperId: string, targetId: string, swipedAt: string }) => Promise<number>} push  Returns the buffer length.
 * @property {(count: number) => Promise<{ swiperId: string, targetId: string, swipedAt: string }[]>} take
 * @property {(swiperId: string) => Promise<Set<string>>} pendingFor
 * @property {(passes: readonly { swiperId: string, targetId: string }[]) => Promise<void>} settle  Clears pending entries once written.
 * @property {(userId: string) => Promise<void>} forget
 */

/**
 * @typedef {object} MatchingDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<MatchingStores>} uow
 * @property {<T>(fn: (stores: MatchingStores) => Promise<T>) => Promise<T>} read
 * @property {PassBuffer} passes
 * @property {{ enqueueWrite: (passes: readonly { swiperId: string, targetId: string, swipedAt: string }[]) => Promise<void>, enqueueFlush: () => Promise<void> }} queue
 * @property {(tx: import('postgres').TransactionSql, a: string, b: string) => Promise<void>} lockPair
 * @property {{ getUsersByPublicIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string, status: string }[]>, getUsersByIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string }[]> }} identity
 * @property {{ isActive: (userId: string) => Promise<boolean>, getCards: (ids: readonly string[]) => Promise<any[]> }} profiles
 * @property {{ wasServed: (viewerId: string, targetId: string) => Promise<boolean> }} discovery
 * @property {{ blockPolicy: { isBlocked: (a: string, b: string, options?: { tx?: import('postgres').TransactionSql }) => Promise<boolean> } }} safety
 * @property {{ now: () => Date }} clock
 * @property {() => string} newId
 * @property {(ms: number) => void} observeLockHold  Pair-lock hold time per like.
 */

export {};
