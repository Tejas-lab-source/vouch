// @ts-check
import { z } from 'zod';

/**
 * Gender codes, stored as `smallint` in `profiles.profiles.gender` and `interested_in`.
 * New codes are additive; existing codes never change meaning.
 */
export const GENDER = Object.freeze({ WOMAN: 0, MAN: 1, NON_BINARY: 2 });

export const Gender = z
  .literal([GENDER.WOMAN, GENDER.MAN, GENDER.NON_BINARY])
  .describe('0 = woman, 1 = man, 2 = non-binary.');

/**
 * The genders a user wants to see ("interests" in roadmap Phase 6). A non-empty set:
 * no duplicates, at most one entry per gender code.
 */
export const InterestedIn = z
  .array(Gender)
  .min(1)
  .max(3)
  .refine((codes) => new Set(codes).size === codes.length, 'interestedIn must not repeat a code')
  .describe('Non-empty set of gender codes the user wants to see.');

/** Client platforms. */
export const Platform = z.enum(['ios', 'android', 'web']);

/** Message kinds. Additive: later features add kinds without a migration. */
export const MessageKind = z.enum(['text']);

/** Report reasons shown in the report sheet. */
export const ReportReason = z.enum([
  'fake_profile',
  'harassment',
  'inappropriate_content',
  'underage',
  'spam',
  'other',
]);

/** Where a report was made from. */
export const ReportContext = z.enum(['profile', 'chat']);

/** Image types accepted for photo uploads. */
export const ImageContentType = z.enum(['image/jpeg', 'image/png', 'image/webp']);

/** Maximum photo upload size: 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Age bounds for preferences (users themselves must be 18+). */
export const AGE = Object.freeze({ MIN: 18, MAX: 99 });

/** Message body length limits for `text` messages. */
export const MESSAGE_BODY = Object.freeze({ MIN: 1, MAX: 1000 });
