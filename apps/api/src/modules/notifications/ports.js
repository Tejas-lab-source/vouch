// @ts-check

/**
 * @typedef {object} PushMessage
 * @property {string} token
 * @property {string} title
 * @property {string} body
 * @property {Record<string, string>} data
 */

/**
 * @typedef {object} PushTicket
 * @property {string} token
 * @property {string | null} ticketId
 * @property {string | null} error  For example `DeviceNotRegistered`.
 */

/**
 * @typedef {object} PushProvider
 * @property {string} name
 * @property {(messages: PushMessage[]) => Promise<PushTicket[]>} send  One ticket per message, in order.
 * @property {(ticketIds: string[]) => Promise<Map<string, string | null>>} receipts  Ticket id → error or null.
 */

/** @typedef {{ send: (mail: { to: string, subject: string, text: string }) => Promise<void> }} AlertEmail */

/** @typedef {Record<string, (...args: any[]) => Promise<any>>} StoreGroup */

/**
 * @typedef {object} NotificationStores
 * @property {StoreGroup} prefs
 * @property {StoreGroup} deliveries
 * @property {StoreGroup} erasure
 */

/**
 * @typedef {object} NotificationDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<NotificationStores>} uow
 * @property {<T>(fn: (stores: NotificationStores) => Promise<T>) => Promise<T>} read
 * @property {(tx: import('postgres').TransactionSql) => NotificationStores} storesFor
 * @property {PushProvider} push
 * @property {AlertEmail} email
 * @property {Map<string, import('./domain/templates.js').PushTemplate>} templates
 * @property {any} identity  identity's public API (push tokens)
 * @property {any} chat  chat's public API (presence)
 * @property {any} matching  matching's public API (pending likes)
 * @property {{ add: (name: string, payload: unknown, options?: any) => Promise<unknown> }} jobs
 * @property {any} redis  ioredis client
 * @property {{ messageBatchSeconds: number, alertEmail: string | null }} settings
 * @property {{ now: () => Date }} clock
 * @property {() => string} newId
 * @property {import('pino').Logger} logger
 * @property {{ setGauge: (name: string, help: string, labels: Record<string, string>, value: number) => void }} [metrics]
 */

export {};
