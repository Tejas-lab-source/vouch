// @ts-check
import { z } from 'zod';
import { AGE, Gender, ImageContentType, InterestedIn, MessageKind } from '../common/codes.js';
import { Message, ProfileCard } from '../common/entities.js';
import { AppErrorCode } from '../common/errors.js';
import { Timestamp, Uuidv7 } from '../common/ids.js';

/**
 * @typedef {object} PipelineDefinition
 * @property {string} name  `<owner>.<chain>`.
 * @property {string} owner  Module that owns the chain; others contribute steps.
 * @property {boolean} failClosed  When true, a failing or slow step fails the whole chain.
 * @property {number} stepTimeoutMs  Default per-step timeout.
 * @property {z.ZodType} input  What each step receives.
 * @property {z.ZodType} output  What each step returns.
 */

/** A candidate as discovery's filters and scorers see it (from `profiles.candidates_v`). */
export const Candidate = z.strictObject({
  userId: Uuidv7,
  collegeId: Uuidv7.optional().describe('Added in Phase 7 for deck diversification.'),
  gender: Gender,
  interestedIn: InterestedIn,
  age: z.int().min(AGE.MIN).max(AGE.MAX),
  minAge: z.int().min(AGE.MIN).max(AGE.MAX),
  maxAge: z.int().min(AGE.MIN).max(AGE.MAX),
  lastActiveAt: Timestamp,
  createdAt: Timestamp,
  approvedPhotos: z.int().min(0),
});

/** Every v1 pipeline (extension point: other modules add steps without editing the owner). */
export const PIPELINES = Object.freeze(
  Object.fromEntries(
    /** @type {PipelineDefinition[]} */ ([
      {
        name: 'discovery.candidateFilters',
        owner: 'discovery',
        failClosed: false,
        stepTimeoutMs: 50,
        input: z.strictObject({ viewer: Candidate, candidates: z.array(Candidate).max(500) }),
        output: z.strictObject({
          candidates: z.array(Candidate).max(500),
          removed: z.array(
            z.strictObject({ userId: Uuidv7, reason: z.string().regex(/^[a-z_]+$/) }),
          ),
        }),
      },
      {
        name: 'discovery.scorers',
        owner: 'discovery',
        failClosed: false,
        stepTimeoutMs: 50,
        input: z.strictObject({ viewer: Candidate, candidate: Candidate }),
        output: z.strictObject({
          score: z.number().min(0).max(1),
          reason: z.string().max(100).describe('Logged at debug level to explain ordering.'),
        }),
      },
      {
        name: 'chat.messageFilters',
        owner: 'chat',
        failClosed: true,
        stepTimeoutMs: 50,
        input: z.strictObject({
          conversationId: Uuidv7,
          senderId: Uuidv7,
          recipientId: Uuidv7,
          kind: MessageKind,
          body: z.string(),
        }),
        output: z.discriminatedUnion('allow', [
          z.strictObject({ allow: z.literal(true), body: z.string() }),
          z.strictObject({
            allow: z.literal(false),
            code: AppErrorCode,
            reason: z
              .string()
              .max(200)
              .optional()
              .describe('Readable reason shown to the sender (Phase 9).'),
          }),
        ]),
      },
      {
        name: 'safety.contentChecks',
        owner: 'safety',
        failClosed: true,
        stepTimeoutMs: 5000,
        input: z.strictObject({
          userId: Uuidv7,
          kind: z.enum(['photo']),
          objectKey: z.string().min(1).max(300),
          contentType: ImageContentType,
          image: z
            .instanceof(Uint8Array)
            .optional()
            .describe(
              'The processed image bytes (Phase 7): providers cannot read private storage.',
            ),
        }),
        output: z.strictObject({
          verdict: z.enum(['approve', 'reject', 'review']),
          reasons: z.array(z.string().max(100)).max(20),
          provider: z.string().min(1).max(40),
        }),
      },
      {
        name: 'safety.reportEvidence',
        owner: 'safety',
        failClosed: true,
        stepTimeoutMs: 2000,
        input: z.strictObject({
          reporterId: Uuidv7,
          targetId: Uuidv7,
          context: z.enum(['profile', 'chat']),
          conversationId: Uuidv7.nullable(),
        }),
        output: z
          .strictObject({
            messages: z.array(Message).max(20),
            refuse: z.enum(['NOT_A_MEMBER']).nullable(),
          })
          .describe(
            'Phase 10: chat contributes the last 20 messages of a chat report, or refuses ' +
              'when the reporter and target are not that conversation’s members.',
          ),
      },
      {
        name: 'profiles.cardFields',
        owner: 'profiles',
        failClosed: false,
        stepTimeoutMs: 50,
        input: ProfileCard,
        output: ProfileCard,
      },
    ]).map((pipeline) => [pipeline.name, Object.freeze(pipeline)]),
  ),
);
