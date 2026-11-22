// @ts-check

/**
 * @typedef {object} ProfileRecord
 * @property {string} userId  Internal user id (never returned to clients).
 * @property {string} collegeId
 * @property {string} clusterId
 * @property {string | null} name
 * @property {number | null} gender
 * @property {number[]} interestedIn
 * @property {string | null} bio
 * @property {string} birthDate  `YYYY-MM-DD`
 * @property {number} minAge
 * @property {number} maxAge
 * @property {import('./domain/profile.js').ProfileStatus} status
 */

/**
 * @typedef {object} PhotoRecord
 * @property {string} id  The upload id (owner decision, Phase 6).
 * @property {string} userId
 * @property {'pending' | 'approved' | 'rejected' | 'deleted'} status
 * @property {number} position
 * @property {string | null} key1080
 * @property {string | null} key400
 */

/**
 * @typedef {object} SectionRecord
 * @property {string} userId
 * @property {string} type
 * @property {number} schemaVersion
 * @property {unknown} data
 * @property {number} position
 */

/** @typedef {{ w1080: string, w400: string }} PhotoKeys */

/**
 * @typedef {object} ProfilesStores
 * @property {{
 *   insertIfMissing(p: { userId: string, collegeId: string, clusterId: string, birthDate: string, at: Date }): Promise<boolean>,
 *   find(userId: string): Promise<ProfileRecord | null>,
 *   findForUpdate(userId: string): Promise<ProfileRecord | null>,
 *   update(userId: string, fields: Pick<ProfileRecord, 'name' | 'gender' | 'interestedIn' | 'bio' | 'minAge' | 'maxAge' | 'status'>, at: Date): Promise<void>,
 *   findActiveMany(ids: readonly string[]): Promise<ProfileRecord[]>,
 *   remove(userId: string): Promise<number>,
 * }} profiles
 * @property {{
 *   listForUser(userId: string): Promise<PhotoRecord[]>,
 *   findForUpdate(id: string): Promise<PhotoRecord | null>,
 *   insert(p: { id: string, userId: string, status: 'pending' | 'approved' | 'rejected', position: number, key1080: string | null, key400: string | null, at: Date }): Promise<void>,
 *   setStatus(id: string, status: PhotoRecord['status'], keys: PhotoKeys | null, at: Date): Promise<void>,
 *   approvedForUsers(ids: readonly string[]): Promise<PhotoRecord[]>,
 * }} photos
 * @property {{
 *   listForUser(userId: string): Promise<SectionRecord[]>,
 *   listForUsers(ids: readonly string[]): Promise<SectionRecord[]>,
 *   upsert(s: SectionRecord & { at: Date }): Promise<void>,
 * }} sections
 * @property {{ byIds(ids: readonly string[]): Promise<{ id: string, name: string, clusterId: string }[]> }} colleges
 */

/**
 * Redis cache of profile cards, `profiles:card:{userId}`, 10 minutes.
 * @typedef {object} CardCache
 * @property {(userIds: readonly string[]) => Promise<Map<string, unknown>>} getMany
 * @property {(cards: readonly { userId: string, card: unknown }[]) => Promise<void>} setMany
 * @property {(userId: string) => Promise<void>} invalidate
 */

/**
 * What profiles uses from identity and media (their public APIs only).
 * @typedef {object} IdentityApi
 * @property {(id: string) => Promise<{ id: string, publicId: string, collegeId: string, status: string, birthDate: Date | string } | null>} getUser
 * @property {(ids: readonly string[]) => Promise<{ id: string, publicId: string }[]>} getUsersByIds
 *
 * @typedef {object} MediaApi
 * @property {(keys: readonly string[]) => Promise<void>} deleteObjects
 * @property {(uploadId: string, userId: string) => Promise<{ released: boolean }>} releaseUpload
 * @property {(key: string) => string} photoUrl
 */

/**
 * Everything the profiles use cases receive.
 * @typedef {object} ProfilesDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<ProfilesStores>} uow
 * @property {<T>(fn: (stores: ProfilesStores) => Promise<T>) => Promise<T>} read
 * @property {CardCache} cards
 * @property {IdentityApi} identity
 * @property {MediaApi} media
 * @property {Map<string, Readonly<import('@vouch/contracts').SectionDefinition>>} sections
 * @property {{ run: (name: string, input: unknown) => Promise<unknown> }} pipelines
 * @property {{ now: () => Date }} clock
 * @property {number} photosMax
 */

export {};
