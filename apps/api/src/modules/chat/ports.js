// @ts-check

/**
 * @typedef {object} ConversationRecord
 * @property {string} id  Equal to the match id (owner decision, Phase 9).
 * @property {string} matchId
 * @property {string} userLow
 * @property {string} userHigh
 * @property {number} lastSeq
 * @property {Date} createdAt
 * @property {Date | null} closedAt
 */

/**
 * @typedef {object} MessageRecord
 * @property {string} conversationId
 * @property {number} seq
 * @property {string} senderId  Internal id.
 * @property {string} clientMsgId
 * @property {string} kind
 * @property {string} body
 * @property {Date} createdAt
 */

/**
 * @typedef {object} ChatStores
 * @property {{
 *   insertIfMissing(c: { id: string, userLow: string, userHigh: string, at: Date }): Promise<boolean>,
 *   find(id: string): Promise<ConversationRecord | null>,
 *   findForUpdate(id: string): Promise<ConversationRecord | null>,
 *   nextSeq(id: string): Promise<number>,
 *   close(id: string, at: Date): Promise<boolean>,
 *   forUser(userId: string, after: { activityAt: Date, id: string } | null, limit: number): Promise<(ConversationRecord & { activityAt: Date })[]>,
 *   openForUser(userId: string): Promise<ConversationRecord[]>,
 * }} conversations
 * @property {{
 *   insert(m: MessageRecord): Promise<void>,
 *   byClientId(conversationId: string, clientMsgId: string): Promise<MessageRecord | null>,
 *   last(conversationId: string, seq: number): Promise<MessageRecord | null>,
 *   after(conversationId: string, afterSeq: number, limit: number): Promise<MessageRecord[]>,
 *   before(conversationId: string, beforeSeq: number, limit: number): Promise<MessageRecord[]>,
 *   countBySender(conversationId: string, senderId: string, upTo: number): Promise<number>,
 *   sentBy(userId: string): Promise<MessageRecord[]>,
 *   removeBySender(userId: string): Promise<number>,
 *   purgeClosed(olderThan: Date, limit: number): Promise<number>,
 * }} messages
 * @property {{
 *   ensure(conversationId: string, userIds: readonly string[]): Promise<void>,
 *   advanceRead(conversationId: string, userId: string, seq: number): Promise<void>,
 *   advanceDelivered(conversationId: string, userId: string, seq: number): Promise<void>,
 *   lastRead(conversationId: string, userId: string): Promise<number>,
 *   get(conversationId: string, userId: string): Promise<{ readSeq: number, deliveredSeq: number }>,
 *   removeForUser(userId: string): Promise<number>,
 * }} cursors
 */

/**
 * Presence in Redis (`chat:presence:{uid}`, 60 s TTL). Only "active recently" leaves chat.
 * @typedef {object} Presence
 * @property {(userId: string) => Promise<void>} touch
 * @property {(userId: string) => Promise<void>} clear
 * @property {(userId: string) => Promise<boolean>} isOnline
 */

/**
 * @typedef {object} ChatDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<ChatStores>} uow
 * @property {<T>(fn: (stores: ChatStores) => Promise<T>) => Promise<T>} read
 * @property {Presence} presence
 * @property {import('../../platform/ws.js').SocketEmitter} sockets
 * @property {{ hit: (limits: { key: string, max: number, windowMs: number }[], options?: { failClosed?: boolean }) => Promise<void> }} rateLimiter
 * @property {{ run: (name: string, input: unknown) => Promise<unknown>, collect: (name: string, input: unknown) => Promise<{ id: string, value: any }[]> }} pipelines
 * @property {{ getUsersByIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string, status: string }[]> }} identity
 * @property {{ getCards: (ids: readonly string[]) => Promise<any[]> }} profiles
 * @property {{ blockPolicy: { isBlocked: (a: string, b: string) => Promise<boolean> }, bannedAmong: (ids: readonly string[]) => Promise<Set<string>>, blockersBetween: (a: string, b: string) => Promise<string[]> }} safety
 * @property {{ getMatch: (id: string) => Promise<{ id: string, userLow: string, userHigh: string, unmatchedAt: Date | null, anonymisedAt: Date | null } | null> }} matching
 * @property {{ messagesPerMinute: number, maxLinksPerMessage: number, linksAfterMessages: number }} settings
 * @property {{ now: () => Date }} clock
 * @property {import('pino').Logger} logger
 */

export {};
