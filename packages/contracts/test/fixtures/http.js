// @ts-check
import * as s from './samples.js';

/**
 * Fixtures for every endpoint part, keyed `<endpointId>.<part>`.
 * Each has at least one valid and one invalid example.
 * @type {Record<string, { valid: unknown[], invalid: unknown[] }>}
 */
export const httpFixtures = {
  // identity
  'requestOtp.body': {
    valid: [
      { email: 'student@northfield.example.edu', turnstileToken: 'tok' },
      { email: 'student@northfield.example.edu', turnstileToken: 'tok', deviceId: s.UUID4 },
      { email: 'student@gmail.example.com', turnstileToken: 'tok', verification: 'id_card' },
    ],
    invalid: [
      { email: 'not-an-email', turnstileToken: 'tok' },
      { email: 'a@b.edu' },
      { email: 'a@b.edu', turnstileToken: 'tok', deviceId: 'phone' },
      { email: 'a@b.edu', turnstileToken: 'tok', verification: 'passport' },
    ],
  },
  'requestOtp.response': {
    valid: [{ sent: true }],
    invalid: [{ sent: false }, { sent: true, exists: true }],
  },
  'verifyOtp.body': {
    valid: [
      { email: 'a@northfield.example.edu', code: '123456', device: { platform: 'ios' } },
      {
        email: 'a@northfield.example.edu',
        code: '123456',
        device: { platform: 'web', appVersion: '1.0.0' },
        tokenTransport: 'cookie',
        signup: {
          birthDate: '2005-01-31',
          gradYear: 2028,
          consent: { noticeVersion: '2026-11', purposes: ['matching'] },
        },
      },
      {
        email: 'a@gmail.example.com',
        code: '123456',
        device: { platform: 'android' },
        verification: 'id_card',
        signup: {
          birthDate: '2005-01-31',
          collegeId: s.ID,
          consent: { noticeVersion: '2026-11', purposes: ['matching'] },
        },
      },
    ],
    invalid: [
      { email: 'a@b.edu', code: '12345', device: { platform: 'ios' } },
      {
        email: 'a@b.edu',
        code: '123456',
        device: { platform: 'ios' },
        signup: { birthDate: '2005-01-31' },
      },
    ],
  },
  'verifyOtp.response': {
    valid: [{ tokens: s.tokens, user: { userId: s.PUBLIC_ID, status: 'active', newUser: false } }],
    invalid: [{ tokens: s.tokens, user: { userId: s.ID, status: 'active', newUser: false } }],
  },
  'refreshTokens.body': {
    valid: [{ refreshToken: 'rt_abc' }, { tokenTransport: 'cookie' }],
    invalid: [{ refreshToken: '' }],
  },
  'refreshTokens.response': {
    valid: [{ tokens: s.tokens }, { tokens: { ...s.tokens, refreshToken: undefined } }],
    invalid: [{ tokens: { accessToken: 'x' } }],
  },
  'deleteAccount.response': {
    valid: [{ deleted: true, erasureDueBy: s.TS }],
    invalid: [{ deleted: true }],
  },
  'exportData.response': {
    valid: [{ generatedAt: s.TS, data: { identity: { email_hmac_prefix: 'ab12' } } }],
    invalid: [{ generatedAt: s.TS, data: { 'Not-A-Module': {} } }],
  },
  'registerDevice.body': {
    valid: [{ pushToken: 'ExponentPushToken[abc]', platform: 'android' }],
    invalid: [{ pushToken: 'ExponentPushToken[abc]', platform: 'windows' }],
  },
  'registerDevice.response': { valid: [{ registered: true }], invalid: [{}] },
  'logout.body': { valid: [{}], invalid: [{ everywhere: true }] },
  'logout.response': { valid: [{ loggedOut: true }], invalid: [{ loggedOut: false }] },
  'listDevices.response': {
    valid: [
      {
        items: [
          {
            id: s.ID,
            platform: 'ios',
            appVersion: '1.0.0',
            createdAt: s.TS,
            lastSeenAt: s.TS,
            current: true,
          },
        ],
      },
      { items: [] },
    ],
    invalid: [
      {
        items: [
          {
            id: s.ID,
            platform: 'ios',
            appVersion: null,
            createdAt: s.TS,
            lastSeenAt: s.TS,
            current: true,
            pushToken: 'x',
          },
        ],
      },
    ],
  },
  'revokeDevice.params': { valid: [{ id: s.ID }], invalid: [{ id: s.UUID4 }] },
  'revokeDevice.response': { valid: [{ revoked: true }], invalid: [{ revoked: 'yes' }] },

  // platform
  'getConfig.response': {
    valid: [s.config, { ...s.config, college: null }],
    invalid: [{ ...s.config, minSupportedVersion: 'latest' }],
  },

  // profiles
  'getMyProfile.response': {
    valid: [s.ownProfile],
    invalid: [{ ...s.ownProfile, birthDate: '2005-01-01' }],
  },
  'updateMyProfile.body': {
    valid: [{ name: 'Aditi' }, { gender: 2, interestedIn: [0, 1, 2], minAge: 20, maxAge: 25 }],
    invalid: [
      {},
      { minAge: 26, maxAge: 20 },
      { interestedIn: [] },
      { interestedIn: [0, 0] },
      { gender: 3 },
    ],
  },
  'updateMyProfile.response': { valid: [s.ownProfile], invalid: [{ ...s.ownProfile, age: 17 }] },
  'deleteMyPhoto.params': { valid: [{ id: s.ID }], invalid: [{ id: 'photo-1' }] },
  'deleteMyPhoto.response': { valid: [s.ownProfile], invalid: [{ ...s.ownProfile, photos: null }] },
  'reorderMyPhotos.body': {
    valid: [{ photoIds: [s.ID] }],
    invalid: [{ photoIds: [] }, { photoIds: ['photo-1'] }, { photoIds: Array(7).fill(s.ID) }],
  },
  'reorderMyPhotos.response': { valid: [s.ownProfile], invalid: [{ ...s.ownProfile, age: 17 }] },
  'putProfileSection.params': { valid: [{ type: 'prompts' }], invalid: [{ type: 'Prompts!' }] },
  'putProfileSection.body': {
    valid: [{ schemaVersion: 1, position: 0, data: { answer: 'x' } }],
    invalid: [{ schemaVersion: 0, position: 0, data: {} }],
  },
  'putProfileSection.response': {
    valid: [{ type: 'prompts', schemaVersion: 1, position: 0, data: {} }],
    invalid: [{ type: 'prompts', schemaVersion: 1, position: -1, data: {} }],
  },

  // media
  'createUpload.body': {
    valid: [{ contentType: 'image/jpeg', sizeBytes: 2_000_000 }],
    invalid: [
      { contentType: 'image/gif', sizeBytes: 10 },
      { contentType: 'image/png', sizeBytes: 10_485_761 },
    ],
  },
  'createUpload.response': {
    valid: [
      {
        uploadId: s.ID,
        url: 'https://storage.example.com/uploads/raw/x?sig=1',
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: s.TS,
      },
    ],
    invalid: [
      {
        uploadId: s.ID,
        url: 'https://x.example.com',
        method: 'POST',
        headers: {},
        expiresAt: s.TS,
      },
    ],
  },
  'confirmUpload.params': { valid: [{ id: s.ID }], invalid: [{ id: s.UUID4 }] },
  'confirmUpload.body': { valid: [{}], invalid: [{ force: true }] },
  'confirmUpload.response': {
    valid: [{ uploadId: s.ID, status: 'processing' }],
    invalid: [{ uploadId: s.ID, status: 'pending' }],
  },

  // discovery
  'getDeck.response': {
    valid: [{ cards: [s.card] }, { cards: [] }],
    invalid: [
      { cards: Array.from({ length: 11 }, () => s.card) },
      { cards: [{ ...s.card, birthDate: '2005-01-01' }] },
    ],
  },

  // matching
  'swipe.body': {
    valid: [{ swipeId: s.UUID4, targetId: s.PUBLIC_ID, direction: 'like' }],
    invalid: [{ swipeId: s.UUID4, targetId: s.PUBLIC_ID, direction: 1 }],
  },
  'swipe.response': {
    valid: [
      { matched: true, matchId: s.ID },
      { matched: false, matchId: null },
    ],
    invalid: [{ matched: true }],
  },
  'listMatches.query': {
    valid: [{}, { cursor: s.CURSOR, limit: '10' }],
    invalid: [{ limit: 0 }, { offset: 5 }],
  },
  'listMatches.response': {
    valid: [
      {
        items: [{ matchId: s.ID, conversationId: null, user: s.card, createdAt: s.TS }],
        nextCursor: null,
      },
    ],
    invalid: [{ items: [] }],
  },
  'unmatch.params': { valid: [{ id: s.ID }], invalid: [{ id: 'abc' }] },
  'unmatch.body': { valid: [{}], invalid: [{ reason: 'x' }] },
  'unmatch.response': {
    valid: [{ matchId: s.ID, unmatchedAt: s.TS }],
    invalid: [{ matchId: s.ID }],
  },
  'getLikesCount.response': {
    valid: [{ count: 0 }, { count: 12 }],
    invalid: [{ count: -1 }, { count: 1.5 }, { count: 3, userIds: [] }],
  },

  // chat
  'listConversations.query': { valid: [{ limit: 5 }], invalid: [{ limit: 51 }] },
  'listConversations.response': {
    valid: [
      {
        items: [
          {
            conversationId: s.ID,
            matchId: s.ID2,
            user: s.card,
            lastMessage: s.message,
            lastReadSeq: 3,
            closed: false,
            updatedAt: s.TS,
          },
        ],
        nextCursor: s.CURSOR,
      },
    ],
    invalid: [{ items: [{ conversationId: s.ID }], nextCursor: null }],
  },
  'listMessages.params': { valid: [{ id: s.ID }], invalid: [{}] },
  'listMessages.query': {
    valid: [{}, { afterSeq: '12', limit: '100' }],
    invalid: [{ afterSeq: -1 }],
  },
  'listMessages.response': {
    valid: [
      {
        items: [s.message],
        nextAfterSeq: 7,
        prevBeforeSeq: null,
        peerDeliveredSeq: 7,
        peerReadSeq: 5,
      },
      { items: [], nextAfterSeq: null, prevBeforeSeq: 12, peerDeliveredSeq: 0, peerReadSeq: 0 },
    ],
    invalid: [
      {
        items: [{ ...s.message, id: s.ID }],
        nextAfterSeq: null,
        prevBeforeSeq: null,
        peerDeliveredSeq: 0,
        peerReadSeq: 0,
      },
      { items: [], nextAfterSeq: null, prevBeforeSeq: null, peerDeliveredSeq: -1, peerReadSeq: 0 },
    ],
  },

  // safety
  'blockUser.body': { valid: [{ targetId: s.PUBLIC_ID }], invalid: [{ targetId: s.ID }] },
  'blockUser.response': { valid: [{ blocked: true }], invalid: [{ blocked: 'yes' }] },
  'getChatSettings.response': {
    valid: [{ shareReadReceipts: false }],
    invalid: [{}, { shareReadReceipts: 'no' }],
  },
  'putChatSettings.body': {
    valid: [{ shareReadReceipts: true }],
    invalid: [{}, { shareReadReceipts: true, extra: 1 }],
  },
  'putChatSettings.response': {
    valid: [{ shareReadReceipts: true }],
    invalid: [{ shareReadReceipts: null }],
  },
  'listMyBlocks.response': {
    valid: [
      { items: [] },
      {
        items: [
          { userId: s.PUBLIC_ID, name: 'Kabir', blockedAt: s.TS },
          { userId: s.PUBLIC_ID, name: null, blockedAt: s.TS },
        ],
      },
    ],
    invalid: [{ items: [{ userId: s.ID, name: 'Kabir', blockedAt: s.TS }] }],
  },
  'unblockUser.params': { valid: [{ userId: s.PUBLIC_ID }], invalid: [{ userId: s.ID }] },
  'unblockUser.response': { valid: [{ unblocked: true }, { unblocked: false }], invalid: [{}] },
  'reportUser.body': {
    valid: [
      { targetId: s.PUBLIC_ID, context: 'profile', reason: 'fake_profile' },
      {
        targetId: s.PUBLIC_ID,
        context: 'chat',
        reason: 'harassment',
        conversationId: s.ID,
        note: 'rude',
      },
    ],
    invalid: [{ targetId: s.PUBLIC_ID, context: 'chat', reason: 'harassment' }],
  },
  'reportUser.response': {
    valid: [{ reportId: s.ID, status: 'open' }],
    invalid: [{ reportId: s.ID, status: 'closed' }],
  },
  'createIdCardUploads.body': {
    valid: [
      {
        idCard: { contentType: 'image/jpeg', sizeBytes: 200_000 },
        selfie: { contentType: 'image/png', sizeBytes: 300_000 },
      },
    ],
    invalid: [
      {
        idCard: { contentType: 'application/pdf', sizeBytes: 200_000 },
        selfie: { contentType: 'image/png', sizeBytes: 300_000 },
      },
      { idCard: { contentType: 'image/jpeg', sizeBytes: 200_000 } },
    ],
  },
  'createIdCardUploads.response': {
    valid: [
      {
        submissionId: s.ID,
        idCard: { url: 'https://r2.example.com/a', method: 'PUT', headers: {} },
        selfie: {
          url: 'https://r2.example.com/b',
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
        },
        expiresAt: s.TS,
      },
    ],
    invalid: [
      { submissionId: s.ID, idCard: { url: 'x', method: 'PUT', headers: {} }, expiresAt: s.TS },
    ],
  },
  'submitIdCard.body': { valid: [{ submissionId: s.ID }], invalid: [{ submissionId: 'x' }] },
  'submitIdCard.response': {
    valid: [{ status: 'pending' }],
    invalid: [{ status: 'approved' }],
  },

  // notifications
  'putNotificationPrefs.body': {
    valid: [
      {
        pushMatches: true,
        pushMessages: true,
        pushLikesDigest: false,
        quietHours: { startMinute: 1380, endMinute: 420 },
        timezone: 'Asia/Kolkata',
      },
      {
        pushMatches: true,
        pushMessages: false,
        pushLikesDigest: true,
        quietHours: null,
        timezone: 'UTC',
      },
    ],
    invalid: [
      {
        pushMatches: true,
        pushMessages: true,
        pushLikesDigest: true,
        quietHours: { startMinute: 1440, endMinute: 0 },
        timezone: 'UTC',
      },
    ],
  },
  'putNotificationPrefs.response': {
    valid: [
      {
        pushMatches: true,
        pushMessages: true,
        pushLikesDigest: true,
        quietHours: null,
        timezone: 'UTC',
      },
    ],
    invalid: [{ pushMatches: true }],
  },
  'getNotificationPrefs.response': {
    valid: [
      {
        pushMatches: true,
        pushMessages: false,
        pushLikesDigest: true,
        quietHours: { startMinute: 1320, endMinute: 420 },
        timezone: 'Asia/Kolkata',
      },
    ],
    invalid: [{ pushMatches: true, timezone: 'UTC' }],
  },

  // admin
  'adminListReports.query': {
    valid: [{}, { status: 'actioned', limit: 50 }],
    invalid: [{ status: 'closed' }],
  },
  'adminListReports.response': {
    valid: [{ items: [s.reportSummary], nextCursor: null }],
    invalid: [{ items: [{ ...s.reportSummary, reporterId: s.ID }], nextCursor: null }],
  },
  'adminGetReport.params': { valid: [{ id: s.ID }], invalid: [{ id: 1 }] },
  'adminGetReport.response': {
    valid: [s.reportDetail],
    invalid: [
      {
        ...s.reportDetail,
        evidence: { card: null, messages: Array.from({ length: 21 }, () => s.message), note: null },
      },
    ],
  },
  'adminActOnReport.params': { valid: [{ id: s.ID }], invalid: [{ id: '' }] },
  'adminActOnReport.body': {
    valid: [
      { action: 'dismiss', note: 'not a violation' },
      { action: 'ban', note: 'repeat', banExpiresAt: s.TS },
    ],
    invalid: [
      { action: 'warn', note: 'x', banExpiresAt: s.TS },
      { action: 'delete', note: 'x' },
    ],
  },
  'adminActOnReport.response': { valid: [s.reportDetail], invalid: [{ reportId: s.ID }] },
  'adminListPhotoReviews.query': { valid: [{}], invalid: [{ limit: 'many' }] },
  'adminListPhotoReviews.response': {
    valid: [
      {
        items: [
          {
            photoId: s.ID,
            userId: s.PUBLIC_ID,
            urls: s.photoUrls,
            reasons: ['nudity'],
            flaggedAt: s.TS,
          },
        ],
        nextCursor: null,
      },
    ],
    invalid: [{ items: [{ photoId: s.ID }], nextCursor: null }],
  },
  'adminDecidePhoto.params': { valid: [{ id: s.ID }], invalid: [{ id: 'x' }] },
  'adminDecidePhoto.body': {
    valid: [{ decision: 'reject', reason: 'nudity' }],
    invalid: [{ decision: 'maybe' }],
  },
  'adminDecidePhoto.response': {
    valid: [{ photoId: s.ID, status: 'approved' }],
    invalid: [{ photoId: s.ID, status: 'pending' }],
  },
  'adminListVerificationReviews.query': {
    valid: [{ status: 'pending' }],
    invalid: [{ status: 'open' }],
  },
  'adminListVerificationReviews.response': {
    valid: [{ items: [s.review], nextCursor: null }],
    invalid: [
      { items: [{ ...s.review, idImageUrl: 'ftp://files.example.com/x' }], nextCursor: null },
      { items: [{ ...s.review, selfieImageUrl: 'not a url' }], nextCursor: null },
    ],
  },
  'adminDecideVerification.params': { valid: [{ id: s.ID }], invalid: [{ id: null }] },
  'adminDecideVerification.body': {
    valid: [{ decision: 'approve' }],
    invalid: [{ decision: 'approve', extra: 1 }],
  },
  'adminDecideVerification.response': {
    valid: [{ ...s.review, status: 'approved', decidedAt: s.TS }],
    invalid: [{ ...s.review, status: 'unknown' }],
  },
  'adminGetUser.params': { valid: [{ userId: s.PUBLIC_ID }], invalid: [{ userId: 'short' }] },
  'adminGetUser.response': {
    valid: [
      {
        userId: s.PUBLIC_ID,
        status: 'active',
        profileStatus: 'active',
        collegeName: 'Riverside College',
        createdAt: s.TS,
        reportsReceived: 2,
        activeBan: null,
      },
    ],
    invalid: [
      {
        userId: s.PUBLIC_ID,
        status: 'active',
        profileStatus: null,
        collegeName: 'R',
        createdAt: s.TS,
        reportsReceived: -1,
        activeBan: null,
      },
    ],
  },
  'adminListBans.query': { valid: [{ active: 'false' }, {}], invalid: [{ active: 'sometimes' }] },
  'adminListBans.response': {
    valid: [{ items: [s.ban], nextCursor: null }],
    invalid: [{ items: [{ ...s.ban, reason: '' }], nextCursor: null }],
  },
  'adminCreateBan.body': {
    valid: [{ userId: s.PUBLIC_ID, reason: 'spam' }],
    invalid: [{ userId: s.PUBLIC_ID }],
  },
  'adminCreateBan.response': { valid: [s.ban], invalid: [{ ...s.ban, banId: 'x' }] },
  'adminLogout.body': { valid: [{}], invalid: [{ everywhere: true }] },
  'adminLogout.response': { valid: [{ loggedOut: true }], invalid: [{ loggedOut: false }] },
  'adminLogin.body': {
    valid: [{ email: 'mod@example.com', password: 'correct horse', totp: '123456' }],
    invalid: [
      { email: 'mod@example.com', password: 'x', totp: '12345' },
      { email: 'mod@example.com', password: 'x' },
    ],
  },
  'adminLogin.response': {
    valid: [
      {
        accessToken: 'eyJ.x.y',
        expiresAt: s.TS,
        admin: { displayName: 'Asha', role: 'moderator' },
      },
    ],
    invalid: [
      { accessToken: 'eyJ.x.y', expiresAt: s.TS, admin: { displayName: 'Asha', role: 'owner' } },
    ],
  },
  'adminListPanels.response': {
    valid: [
      {
        items: [
          {
            id: 'safety.reports',
            module: 'safety',
            title: 'Reports',
            roles: ['moderator', 'admin'],
            list: { endpoint: 'adminListReports', columns: [{ field: 'reason', label: 'Reason' }] },
            detail: {
              endpoint: 'adminGetReport',
              fields: [{ field: 'evidence', label: 'Evidence', kind: 'json' }],
            },
            actions: [
              {
                id: 'dismiss',
                label: 'Dismiss',
                endpoint: 'adminActOnReport',
                body: { action: 'dismiss' },
                needsNote: true,
              },
            ],
          },
        ],
      },
    ],
    invalid: [
      {
        items: [
          {
            id: 'X',
            module: 'safety',
            title: 'Reports',
            roles: [],
            list: { endpoint: 'listReports', columns: [] },
            detail: null,
            actions: [],
          },
        ],
      },
    ],
  },
  'adminListOverdueDeletions.response': {
    valid: [{ items: [{ userId: s.PUBLIC_ID, deletedAt: s.TS, pendingConsumers: ['chat'] }] }],
    invalid: [{ items: [{ userId: s.PUBLIC_ID, deletedAt: s.TS, pendingConsumers: [] }] }],
  },
  'adminUnblock.params': { valid: [{ userId: s.PUBLIC_ID }], invalid: [{ userId: s.ID }] },
  'adminUnblock.body': {
    valid: [{ otherUserId: s.PUBLIC_ID2, note: 'blocked by mistake' }],
    invalid: [{ otherUserId: s.PUBLIC_ID2 }],
  },
  'adminUnblock.response': { valid: [{ unblocked: true }], invalid: [{ unblocked: 'yes' }] },
  'adminLiftBan.params': { valid: [{ id: s.ID }], invalid: [{ id: s.PUBLIC_ID }] },
  'adminLiftBan.body': { valid: [{}], invalid: [{ now: true }] },
  'adminLiftBan.response': {
    valid: [{ ...s.ban, liftedAt: s.TS }],
    invalid: [{ ...s.ban, liftedAt: 'yesterday' }],
  },
  'adminListAuditLog.query': {
    valid: [{ targetType: 'user', targetId: s.PUBLIC_ID }],
    invalid: [{ actor: 'x' }],
  },
  'adminListAuditLog.response': {
    valid: [
      {
        items: [
          {
            id: s.ID,
            actorName: 'Mod One',
            action: 'report.dismiss',
            targetType: 'report',
            targetId: s.ID,
            details: {},
            createdAt: s.TS,
          },
        ],
        nextCursor: null,
      },
    ],
    invalid: [
      {
        items: [
          {
            id: s.ID,
            actorName: 'Mod',
            action: 'Report Dismiss',
            targetType: 'report',
            targetId: s.ID,
            details: {},
            createdAt: s.TS,
          },
        ],
        nextCursor: null,
      },
    ],
  },
  'adminListFlags.response': {
    valid: [{ items: [s.flag] }],
    invalid: [{ items: [{ ...s.flag, key: 'Bad Key' }] }],
  },
  'adminPutFlag.params': { valid: [{ key: 'chat.links' }], invalid: [{ key: '' }] },
  'adminPutFlag.body': {
    valid: [
      { enabled: true, rules: [{ type: 'campus', collegeIds: [s.ID] }, { type: 'killSwitch' }] },
    ],
    invalid: [
      { enabled: true, rules: [{ type: 'percentage', percent: 101 }] },
      { enabled: true, rules: [{ type: 'region' }] },
    ],
  },
  'adminPutFlag.response': { valid: [s.flag], invalid: [{ ...s.flag, updatedAt: 'now' }] },
};
