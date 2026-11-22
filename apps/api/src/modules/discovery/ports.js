// @ts-check

/**
 * @typedef {import('zod').output<typeof import('@vouch/contracts').Candidate>} CandidateShape
 * @typedef {CandidateShape & { collegeId: string }} Candidate
 * @typedef {Candidate & { clusterId: string }} Viewer
 */

/**
 * Reads candidates from the published views (`profiles.candidates_v`, `matching.seen_v`,
 * `safety.block_pairs_v`, `identity.active_users_v`), on the read replica when configured.
 * @typedef {object} CandidateSource
 * @property {(userId: string, today: Date) => Promise<Viewer | null>} viewer  Null unless active.
 * @property {(viewer: Viewer, today: Date, limit: number) => Promise<Candidate[]>} candidates
 *   Eligible people in the viewer's cluster only, most recently active first.
 * @property {(viewerId: string, ids: readonly string[]) => Promise<Set<string>>} swipedAmong
 */

/**
 * Decks, served sets and exposure counters in Redis.
 * @typedef {object} DeckStore
 * @property {(userId: string, ids: readonly string[]) => Promise<void>} write  Replaces the deck, resets served.
 * @property {(userId: string, count: number) => Promise<string[] | null>} pop  Null when no deck exists.
 * @property {(userId: string) => Promise<number>} remaining
 * @property {(userId: string, ids: readonly string[]) => Promise<void>} markServed
 * @property {(userId: string, targetId: string) => Promise<boolean>} wasServed
 * @property {(userId: string, otherId: string) => Promise<void>} remove
 * @property {(userId: string) => Promise<void>} drop
 * @property {(ids: readonly string[], day: string) => Promise<Map<string, number>>} exposure
 * @property {(ids: readonly string[], day: string) => Promise<void>} countExposure
 */

/**
 * @typedef {object} Ranker
 * @property {(scored: readonly import('./domain/ranking.js').Scored[]) => import('./domain/ranking.js').Ranked[]} rank
 */

/**
 * @typedef {object} RankingSettings
 * @property {number} weightBase
 * @property {number} weightRecency
 * @property {number} weightCompleteness
 * @property {number} weightNewUser
 * @property {number} recencyHalfLifeHours
 * @property {number} newUserDays
 * @property {number} exposureCap
 * @property {number} maxNewUsersTop10
 * @property {number} maxPhotos
 */

/**
 * @typedef {object} DiscoveryDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<{}>} uow  For the deck.served.v1 outbox write.
 * @property {CandidateSource} source
 * @property {DeckStore} decks
 * @property {Ranker} ranker
 * @property {RankingSettings} settings
 * @property {import('../../platform/pipelines.js').Pipelines} pipelines
 * @property {{ blockPolicy: { blockedAmong: (viewerId: string, ids: readonly string[]) => Promise<Set<string>> }, bannedAmong: (ids: readonly string[]) => Promise<Set<string>> }} safety
 * @property {{ getCards: (ids: readonly string[]) => Promise<any[]> }} profiles
 * @property {{ getUsersByPublicIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string }[]> }} identity
 * @property {{ enqueueBuild: (userId: string, reason: 'initial' | 'refill' | 'eligibility_changed') => Promise<void> }} builds
 * @property {{ now: () => Date }} clock
 * @property {import('pino').Logger} logger
 */

export {};
