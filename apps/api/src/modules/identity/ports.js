// @ts-check

/**
 * Ports of the identity module: what its use cases need from outside. Adapters implement them;
 * use-case tests pass in-memory fakes.
 */

/**
 * @typedef {object} UserRecord
 * @property {string} id
 * @property {string} publicId
 * @property {string} collegeId
 * @property {'pending' | 'pending_review' | 'active' | 'banned' | 'deleted'} status
 * @property {string} birthDate  `YYYY-MM-DD`
 * @property {number | null} gradYear
 * @property {Date} createdAt
 * @property {Date | null} deletedAt
 * @property {string | null} [inviteCodeId]  The invite code that admitted the account (Phase 15).
 */

/**
 * @typedef {object} SessionRecord
 * @property {string} id
 * @property {string} userId
 * @property {string} deviceId
 * @property {string} familyId
 * @property {string | null} replacedBy
 * @property {Date} expiresAt
 * @property {Date | null} revokedAt
 */

/**
 * @typedef {object} DeviceRecord
 * @property {string} id
 * @property {string} userId
 * @property {'ios' | 'android' | 'web'} platform
 * @property {string | null} appVersion
 * @property {Date} createdAt
 * @property {Date} lastSeenAt
 * @property {Date | null} revokedAt
 */

/**
 * Stores bound to one transaction (as `vouch_identity`).
 * @typedef {object} IdentityStores
 * @property {{
 *   findByEmailHmac(emailHmac: Buffer): Promise<UserRecord | null>,
 *   findById(id: string): Promise<UserRecord | null>,
 *   findManyByIds(ids: readonly string[]): Promise<UserRecord[]>,
 *   findManyByPublicIds(publicIds: readonly string[]): Promise<UserRecord[]>,
 *   insert(user: { id: string, publicId: string, collegeId: string, emailHmac: Buffer, status: 'active' | 'pending_review', birthDate: string, gradYear: number | null, createdAt: Date, inviteCodeId?: string | null }): Promise<void>,
 *   deletedBefore(cutoff: Date, limit: number): Promise<UserRecord[]>,
 *   markDeleted(id: string, at: Date): Promise<void>,
 *   setStatus(id: string, status: UserRecord['status']): Promise<void>,
 * }} users
 * @property {{
 *   insert(session: { id: string, userId: string, deviceId: string, familyId: string, tokenHash: Buffer, createdAt: Date, expiresAt: Date }): Promise<void>,
 *   findByTokenHashForUpdate(tokenHash: Buffer): Promise<SessionRecord | null>,
 *   findById(id: string): Promise<SessionRecord | null>,
 *   findByIdForUpdate(id: string): Promise<SessionRecord | null>,
 *   isLive(id: string, userId: string): Promise<boolean>,
 *   markRotated(id: string, replacedBy: string, at: Date): Promise<void>,
 *   revokeFamily(familyId: string, at: Date): Promise<number>,
 *   revokeAllForUser(userId: string, at: Date): Promise<number>,
 *   revokeAllForDevice(deviceId: string, at: Date): Promise<number>,
 * }} sessions
 * @property {{
 *   insert(device: { id: string, userId: string, platform: DeviceRecord['platform'], appVersion: string | null, at: Date }): Promise<void>,
 *   listActive(userId: string): Promise<DeviceRecord[]>,
 *   findForUser(id: string, userId: string): Promise<DeviceRecord | null>,
 *   revoke(id: string, at: Date): Promise<void>,
 *   setPushToken(id: string, pushToken: string, platform: DeviceRecord['platform'], at: Date): Promise<void>,
 *   touch(id: string, at: Date): Promise<void>,
 *   pushTokensOf(userId: string): Promise<string[]>,
 *   clearPushToken(pushToken: string): Promise<number>,
 * }} devices
 * @property {{
 *   insert(ban: { banId: string, emailHmac: Buffer, expiresAt: Date | null }): Promise<void>,
 *   removeByBan(banId: string): Promise<void>,
 *   isBanned(emailHmac: Buffer, now: Date): Promise<boolean>,
 * }} bannedEmails
 * @property {{
 *   insert(code: { id: string, codeHash: Buffer, collegeId: string, label: string, maxUses: number | null, expiresAt: Date | null, at: Date }): Promise<void>,
 *   findUsable(codeHash: Buffer, collegeId: string, now: Date): Promise<string | null>,
 *   redeem(codeHash: Buffer, collegeId: string, now: Date): Promise<string | null>,
 * }} inviteCodes  Invite codes (Phase 15): `redeem` counts one use atomically, or returns null.
 * @property {{
 *   insert(consent: { id: string, userId: string, noticeVersion: string, purposes: string[], at: Date }): Promise<void>,
 *   listForUser(userId: string): Promise<{ noticeVersion: string, purposes: string[], grantedAt: Date, withdrawnAt: Date | null }[]>,
 * }} consents
 */

/**
 * @typedef {object} OtpRecord
 * @property {string} codeHash
 * @property {number} attempts
 */

/**
 * Hashed one-time codes in Redis (`identity:otp:{emailHmac}`, 10-minute TTL).
 * Every method throws when Redis is unavailable.
 * @typedef {object} OtpStore
 * @property {(key: string, codeHash: string, ttlMs: number) => Promise<void>} save  Replaces any previous code.
 * @property {(key: string) => Promise<OtpRecord | null>} get
 * @property {(key: string) => Promise<number>} addFailedAttempt  Returns the attempt count after this one.
 * @property {(key: string) => Promise<boolean>} consume  True for exactly one caller.
 */

/**
 * @typedef {object} College
 * @property {string} id
 * @property {string} clusterId
 * @property {string[]} emailDomains
 */

/**
 * @typedef {object} IdentityCrypto
 * @property {(address: string) => Buffer} hmacEmail  HMAC-SHA256 with the server secret.
 * @property {(emailHmac: Buffer, code: string) => string} hashCode
 * @property {(token: string) => Buffer} hashToken  SHA-256 of a refresh token or a normalised invite code.
 * @property {(a: string, b: string) => boolean} safeEqual  Constant-time comparison.
 * @property {() => string} randomCode  6 digits from `crypto.randomInt`.
 * @property {() => string} randomToken  32 random bytes, base64url.
 * @property {() => string} randomPublicId  16 random bytes, base64url (22 characters).
 */

/**
 * @typedef {object} TokenIssuer
 * @property {(claims: { userId: string, sessionId: string, pendingReview?: boolean }) => Promise<{ token: string, expiresAt: Date }>} issueAccessToken
 */

/**
 * @typedef {object} EmailProvider
 * @property {(message: { to: string, code: string, emailHmac: Buffer }) => Promise<void>} sendOtp
 */

/**
 * @typedef {object} CaptchaVerifier
 * @property {(token: string, ip: string) => Promise<boolean>} verify
 */

/**
 * @typedef {object} IdentityLimits
 * @property {number} otpEmail15m
 * @property {number} otpEmailDay
 * @property {number} otpIpHour
 * @property {number} otpDeviceHour
 * @property {number} verifyIp15m
 * @property {number} refreshSessionHour
 * @property {number} refreshReuseGraceMs  A rotated token may be retried this long (ADR 0011).
 */

/**
 * Everything the identity use cases receive.
 * @typedef {object} IdentityDeps
 * @property {import('../../platform/use-case.js').UseCaseFactory} useCase
 * @property {import('../../platform/uow.js').UnitOfWork<IdentityStores>} uow
 * @property {<T>(fn: (stores: IdentityStores) => Promise<T>) => Promise<T>} read  Read-only transaction.
 * @property {OtpStore} otpStore
 * @property {{ all: () => Promise<College[]> }} colleges
 * @property {IdentityCrypto} crypto
 * @property {TokenIssuer} tokens
 * @property {EmailProvider} email
 * @property {CaptchaVerifier} captcha
 * @property {{ hit: (limits: { key: string, max: number, windowMs: number }[], options?: { failClosed?: boolean }) => Promise<void> }} rateLimiter
 * @property {IdentityLimits} limits
 * @property {{ now: () => Date }} clock
 * @property {() => string} newId
 * @property {string} privacyNoticeVersion
 * @property {boolean} idCardFallback  Sign-up with any email plus a reviewed student ID (Phase 10).
 * @property {(collegeId: string) => Promise<boolean>} inviteOnly  Whether new sign-ups at this college need an invite code (the `beta.invite_only` flag, Phase 15).
 * @property {Map<string, (userId: string) => Promise<Record<string, unknown>>>} exporters
 */

/**
 * @typedef {object} UserRecordWithEmail
 * @property {Buffer} emailHmac
 */

export {};
