// @ts-check

/** @typedef {Record<string, (...args: any[]) => Promise<any>>} StoreGroup */

/**
 * @typedef {object} AdminStores
 * @property {StoreGroup} staff  `admin.admin_users`
 * @property {StoreGroup} audit  `admin.audit_log` (append-only)
 * @property {StoreGroup} flags  `platform.feature_flags`
 * @property {StoreGroup} platform  colleges and deletion progress (read-only)
 */

/**
 * @typedef {object} StaffMember
 * @property {string} id
 * @property {string} displayName
 * @property {'moderator' | 'admin'} role
 */

/**
 * @typedef {object} AdminDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<AdminStores>} uow
 * @property {<T>(fn: (stores: AdminStores) => Promise<T>) => Promise<T>} read
 * @property {import('./adapters/crypto/node-crypto.js').AdminCrypto} crypto
 * @property {{ sign: (staff: StaffMember) => Promise<{ token: string, expiresAt: Date }> }} tokens
 * @property {{ hit: (limits: { key: string, max: number, windowMs: number }[], options?: { failClosed?: boolean }) => Promise<void> }} rateLimiter
 * @property {any} identity  identity's public API
 * @property {any} profiles  profiles' public API
 * @property {any} safety  safety's public API
 * @property {{ invalidate: () => Promise<void> }} flags
 * @property {{ broadcast: (event: string, payload: unknown) => void }} sockets
 * @property {any[]} panels  Every module's admin panels (filled during boot).
 * @property {Map<string, readonly string[]>} subscriptions  Event → consumer modules.
 * @property {{ ipAllowlist: string[] }} settings
 * @property {{ now: () => Date }} clock
 * @property {() => string} newId
 * @property {import('pino').Logger} logger
 */

export {};
