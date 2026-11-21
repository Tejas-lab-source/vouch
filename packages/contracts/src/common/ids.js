// @ts-check
import { z } from 'zod';

/**
 * Users are only ever addressed by their random public id (ADR 0007).
 */
export const PublicUserId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,32}$/)
  .describe('Random public id of a user. Internal user UUIDs are never exposed.');

/**
 * Internal UUIDv7. Exposed to clients only for non-user resources: matches, conversations,
 * uploads, photos (own) and reports; and to staff in the admin API (ADR 0007).
 */
export const Uuidv7 = z.uuidv7();

export const MatchId = Uuidv7.describe('Match id (UUIDv7).');
export const ConversationId = Uuidv7.describe('Conversation id (UUIDv7).');
export const UploadId = Uuidv7.describe('Upload id (UUIDv7).');
export const PhotoId = Uuidv7.describe('Photo id (UUIDv7).');
export const ReportId = Uuidv7.describe('Report id (UUIDv7).');
export const BanId = Uuidv7.describe('Ban id (UUIDv7, admin API only).');
export const ReviewId = Uuidv7.describe('Verification review id (UUIDv7, admin API only).');
export const AuditEntryId = Uuidv7.describe('Audit log entry id (UUIDv7, admin API only).');
export const CollegeId = Uuidv7.describe('College id (UUIDv7). Colleges are not personal data.');

/** Client-generated idempotency id for a message (the dedupe key in chat.messages). */
export const ClientMsgId = z.uuid().describe('Client-generated UUID, unique per conversation.');

/** Client-generated idempotency id for a swipe. */
export const SwipeId = z.uuid().describe('Client-generated UUID; a repeated swipeId is a no-op.');

/** Per-conversation message sequence number; gapless and starting at 1. */
export const Seq = z.int().min(1);

/** ISO 8601 timestamp with an offset, for example `2026-11-21T10:00:00Z`. */
export const Timestamp = z.iso.datetime({ offset: true });

/** ISO 8601 calendar date, for example `2004-05-17`. */
export const IsoDate = z.iso.date();
