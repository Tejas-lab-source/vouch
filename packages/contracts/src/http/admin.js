// @ts-check
import { z } from 'zod';
import { ReportContext, ReportReason } from '../common/codes.js';
import { Message, PhotoUrls, ProfileCard } from '../common/entities.js';
import {
  AuditEntryId,
  BanId,
  PhotoId,
  PublicUserId,
  ReportId,
  ReviewId,
  Timestamp,
} from '../common/ids.js';
import { Cursor, page, PageQuery } from '../common/pagination.js';
import { Flag, FlagKey, FlagRule } from '../config/index.js';
import { defineEndpoint, EmptyBody } from './endpoint.js';

/**
 * Admin routes. Every route needs an admin token (separate audience claim), MFA and, when
 * configured, an allowlisted IP. Every action writes one `admin.audit_log` entry. Admin login
 * and MFA enrolment endpoints are added in Phase 10 (additive).
 */

const ReportStatus = z.enum(['open', 'actioned', 'dismissed']);

/** A report in the moderation queue. */
export const ReportSummary = z.strictObject({
  reportId: ReportId,
  status: ReportStatus,
  context: ReportContext,
  reason: ReportReason,
  reporterId: PublicUserId,
  targetId: PublicUserId,
  createdAt: Timestamp,
  closedAt: Timestamp.nullable(),
});

/** The evidence snapshot taken when the report was made. */
export const ReportEvidence = z.strictObject({
  card: ProfileCard.nullable(),
  messages: z.array(Message).max(20).describe('Last 20 messages, for chat reports only.'),
  note: z.string().max(500).nullable(),
});

export const ReportDetail = z.strictObject({
  ...ReportSummary.shape,
  evidence: ReportEvidence,
  priorReportsAgainstTarget: z.int().min(0),
});

export const listReports = defineEndpoint({
  id: 'adminListReports',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/reports',
  auth: 'admin',
  summary: 'Moderation queue, oldest first, filtered by status.',
  query: z.strictObject({ ...PageQuery.shape, status: ReportStatus.default('open') }),
  response: { status: 200, schema: page(ReportSummary) },
});

export const getReport = defineEndpoint({
  id: 'adminGetReport',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/reports/{id}',
  auth: 'admin',
  summary: 'One report with its evidence snapshot (the only way staff can read chat).',
  params: z.strictObject({ id: ReportId }),
  response: { status: 200, schema: ReportDetail },
  errors: ['NOT_FOUND'],
});

export const actOnReport = defineEndpoint({
  id: 'adminActOnReport',
  module: 'admin',
  method: 'POST',
  path: '/v1/admin/reports/{id}/actions',
  auth: 'admin',
  summary: 'Resolve a report: dismiss, warn, hide, unhide or ban the target.',
  params: z.strictObject({ id: ReportId }),
  body: z
    .strictObject({
      action: z.enum(['dismiss', 'warn', 'hide', 'unhide', 'ban']),
      note: z.string().min(1).max(500),
      banExpiresAt: Timestamp.optional().describe('Only for `ban`; omit for a permanent ban.'),
    })
    .refine(
      (body) => body.action === 'ban' || body.banExpiresAt === undefined,
      'banExpiresAt is only for ban',
    ),
  response: { status: 200, schema: ReportDetail },
  errors: ['NOT_FOUND', 'CONFLICT'],
});

/** A photo flagged by the moderation provider. */
export const PhotoReviewItem = z.strictObject({
  photoId: PhotoId,
  userId: PublicUserId,
  urls: PhotoUrls,
  reasons: z.array(z.string().max(100)).max(20),
  flaggedAt: Timestamp,
});

export const listPhotoReviews = defineEndpoint({
  id: 'adminListPhotoReviews',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/photo-reviews',
  auth: 'admin',
  summary: 'Photos waiting for a human decision.',
  query: PageQuery,
  response: { status: 200, schema: page(PhotoReviewItem) },
});

export const decidePhoto = defineEndpoint({
  id: 'adminDecidePhoto',
  module: 'admin',
  method: 'POST',
  path: '/v1/admin/photo-reviews/{id}/decision',
  auth: 'admin',
  summary: 'Approve or reject a flagged photo.',
  params: z.strictObject({ id: PhotoId }),
  body: z.strictObject({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(500).optional(),
  }),
  response: {
    status: 200,
    schema: z.strictObject({ photoId: PhotoId, status: z.enum(['approved', 'rejected']) }),
  },
  errors: ['NOT_FOUND', 'CONFLICT'],
});

const ReviewStatus = z.enum(['pending', 'approved', 'rejected']);

/** An ID-card fallback verification request. */
export const VerificationReview = z.strictObject({
  reviewId: ReviewId,
  userId: PublicUserId,
  status: ReviewStatus,
  idImageUrl: z
    .url({ protocol: /^https$/ })
    .nullable()
    .describe(
      'Short-lived signed URL; null after the image is deleted (30 days after the decision).',
    ),
  submittedAt: Timestamp,
  decidedAt: Timestamp.nullable(),
});

export const listVerificationReviews = defineEndpoint({
  id: 'adminListVerificationReviews',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/verification-reviews',
  auth: 'admin',
  summary: 'ID-card fallback queue, oldest first.',
  query: z.strictObject({ ...PageQuery.shape, status: ReviewStatus.default('pending') }),
  response: { status: 200, schema: page(VerificationReview) },
});

export const decideVerification = defineEndpoint({
  id: 'adminDecideVerification',
  module: 'admin',
  method: 'POST',
  path: '/v1/admin/verification-reviews/{id}/decision',
  auth: 'admin',
  summary: 'Approve (activates the user) or reject an ID-card verification.',
  params: z.strictObject({ id: ReviewId }),
  body: z.strictObject({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(500).optional(),
  }),
  response: { status: 200, schema: VerificationReview },
  errors: ['NOT_FOUND', 'CONFLICT'],
});

/** A ban, as shown to staff. */
export const Ban = z.strictObject({
  banId: BanId,
  userId: PublicUserId,
  reason: z.string().min(1).max(500),
  createdAt: Timestamp,
  expiresAt: Timestamp.nullable(),
  liftedAt: Timestamp.nullable(),
});

/** What staff see when looking a user up by public id. */
export const AdminUserView = z.strictObject({
  userId: PublicUserId,
  status: z.enum(['pending', 'pending_review', 'active', 'banned', 'deleted']),
  profileStatus: z.enum(['pending', 'active', 'hidden']).nullable(),
  collegeName: z.string().min(1).max(200),
  createdAt: Timestamp,
  reportsReceived: z.int().min(0),
  activeBan: Ban.nullable(),
});

export const getUser = defineEndpoint({
  id: 'adminGetUser',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/users/{userId}',
  auth: 'admin',
  summary: 'Look a user up by public id.',
  params: z.strictObject({ userId: PublicUserId }),
  response: { status: 200, schema: AdminUserView },
  errors: ['NOT_FOUND'],
});

export const listBans = defineEndpoint({
  id: 'adminListBans',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/bans',
  auth: 'admin',
  summary: 'List bans, newest first.',
  query: z.strictObject({ ...PageQuery.shape, active: z.stringbool().default(true) }),
  response: { status: 200, schema: page(Ban) },
});

export const createBan = defineEndpoint({
  id: 'adminCreateBan',
  module: 'admin',
  method: 'POST',
  path: '/v1/admin/bans',
  auth: 'admin',
  summary: 'Ban a user directly (outside a report). Emits user.banned.v1.',
  body: z.strictObject({
    userId: PublicUserId,
    reason: z.string().min(1).max(500),
    expiresAt: Timestamp.optional(),
  }),
  response: { status: 201, schema: Ban },
  errors: ['NOT_FOUND', 'CONFLICT'],
});

export const liftBan = defineEndpoint({
  id: 'adminLiftBan',
  module: 'admin',
  method: 'POST',
  path: '/v1/admin/bans/{id}/lift',
  auth: 'admin',
  summary: 'Lift a ban. Idempotent on the ban id.',
  idempotency: 'path',
  idempotencyField: 'id',
  params: z.strictObject({ id: BanId }),
  body: EmptyBody,
  response: { status: 200, schema: Ban },
  errors: ['NOT_FOUND'],
});

/** One audit log entry (read-only). */
export const AuditEntry = z.strictObject({
  id: AuditEntryId,
  actorName: z.string().min(1).max(100),
  action: z
    .string()
    .regex(/^[a-z][a-z_.]{2,79}$/)
    .describe('Dotted action name, for example report.dismiss.'),
  targetType: z.string().min(1).max(40),
  targetId: z.string().min(1).max(64),
  details: z.record(z.string(), z.unknown()).describe('Action-specific; never contains PII.'),
  createdAt: Timestamp,
});

export const listAuditLog = defineEndpoint({
  id: 'adminListAuditLog',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/audit-log',
  auth: 'admin',
  summary: 'Read the audit log, newest first.',
  query: z.strictObject({
    cursor: Cursor.optional(),
    limit: PageQuery.shape.limit,
    targetType: z.string().min(1).max(40).optional(),
    targetId: z.string().min(1).max(64).optional(),
  }),
  response: { status: 200, schema: page(AuditEntry) },
});

export const listFlags = defineEndpoint({
  id: 'adminListFlags',
  module: 'admin',
  method: 'GET',
  path: '/v1/admin/flags',
  auth: 'admin',
  summary: 'List every feature flag with its rules.',
  response: { status: 200, schema: z.strictObject({ items: z.array(Flag) }) },
});

export const putFlag = defineEndpoint({
  id: 'adminPutFlag',
  module: 'admin',
  method: 'PUT',
  path: '/v1/admin/flags/{key}',
  auth: 'admin',
  summary: 'Create or replace a flag. Connected clients receive `config.changed`.',
  params: z.strictObject({ key: FlagKey }),
  body: z.strictObject({ enabled: z.boolean(), rules: z.array(FlagRule).max(20) }),
  response: { status: 200, schema: Flag },
});

export const adminEndpoints = [
  listReports,
  getReport,
  actOnReport,
  listPhotoReviews,
  decidePhoto,
  listVerificationReviews,
  decideVerification,
  getUser,
  listBans,
  createBan,
  liftBan,
  listAuditLog,
  listFlags,
  putFlag,
];
