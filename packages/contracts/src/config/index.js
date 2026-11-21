// @ts-check
import { z } from 'zod';
import { AGE, MAX_UPLOAD_BYTES, MESSAGE_BODY, Platform } from '../common/codes.js';
import { SemVer } from '../common/headers.js';
import { CollegeId, Timestamp, Uuidv7 } from '../common/ids.js';

/** Feature flag key, as stored in `platform.feature_flags.key`. */
export const FlagKey = z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/);

/**
 * One targeting rule. A flag is on for a user when it is enabled and every rule matches.
 * `killSwitch` forces the flag off for everyone. New rule types are additive.
 */
export const FlagRule = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('campus'), collegeIds: z.array(CollegeId).min(1) }),
  z.strictObject({
    type: z.literal('cohort'),
    cohorts: z.array(z.string().regex(/^[a-z0-9_-]{1,40}$/)).min(1),
  }),
  z.strictObject({ type: z.literal('percentage'), percent: z.number().min(0).max(100) }),
  z.strictObject({ type: z.literal('platform'), platforms: z.array(Platform).min(1) }),
  z.strictObject({ type: z.literal('minAppVersion'), version: SemVer }),
  z.strictObject({ type: z.literal('killSwitch') }),
]);

/** A flag with its rules, as managed in the admin API. */
export const Flag = z.strictObject({
  key: FlagKey,
  enabled: z.boolean(),
  rules: z.array(FlagRule).max(20),
  updatedAt: Timestamp,
});

/** Limits clients use to validate input before sending it. */
export const ClientLimits = z.strictObject({
  minPhotos: z.int().min(1),
  maxPhotos: z.int().min(1),
  maxUploadBytes: z.int().max(MAX_UPLOAD_BYTES),
  messageMaxLength: z.int().max(MESSAGE_BODY.MAX),
  bioMaxLength: z.int().min(1),
  minAge: z.int().min(AGE.MIN),
  maxAge: z.int().max(AGE.MAX),
});

/** `GET /v1/config`: everything a client needs at start-up and on `config.changed`. */
export const ConfigResponse = z.strictObject({
  minSupportedVersion: SemVer.describe('Older builds must update (APP_VERSION_UNSUPPORTED).'),
  latestVersion: SemVer,
  privacyNoticeVersion: z.string().min(1).max(40),
  flags: z.record(FlagKey, z.boolean()).describe('Flags evaluated for this caller.'),
  college: z
    .strictObject({ id: CollegeId, name: z.string().min(1).max(200), clusterId: Uuidv7 })
    .nullable()
    .describe('The signed-in user’s college; null when signed out.'),
  limits: ClientLimits,
  sectionTypes: z.array(z.string()).describe('Registered profile section types (empty in v1).'),
});
