// @ts-check
import { z } from 'zod';
import { AGE, Gender, MESSAGE_BODY, MessageKind } from './codes.js';
import { ClientMsgId, ConversationId, PhotoId, PublicUserId, Seq, Timestamp } from './ids.js';

/** CDN URLs of a photo's two WebP variants. */
export const PhotoUrls = z.strictObject({
  w400: z.url({ protocol: /^https?$/ }).describe('400 px variant, used in decks.'),
  w1080: z.url({ protocol: /^https?$/ }).describe('1080 px variant, used in detail views.'),
});

/** One profile section as stored and returned (extension point 9). */
export const SectionEntry = z.strictObject({
  type: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  schemaVersion: z.int().min(1),
  position: z.int().min(0),
  data: z.unknown().describe('Validated against the zod schema registered for `type`.'),
});

/**
 * The profile card other users see. Age is derived; birth date is never exposed.
 * `sections` is empty in v1.
 */
export const ProfileCard = z.strictObject({
  userId: PublicUserId,
  name: z.string().min(1).max(50),
  age: z.int().min(AGE.MIN).max(AGE.MAX),
  gender: Gender,
  collegeName: z.string().min(1).max(200),
  bio: z.string().max(500).nullable(),
  photos: z.array(PhotoUrls).min(1).max(6),
  sections: z.array(SectionEntry),
});

/** A photo on the owner's own profile. */
export const OwnPhoto = z.strictObject({
  id: PhotoId,
  position: z.int().min(0).max(5),
  status: z.enum(['pending', 'approved', 'rejected']),
  urls: PhotoUrls.nullable().describe('Null until the photo is approved.'),
});

/** What the profile still needs before it can become active. */
export const ProfileRequirement = z.enum(['name', 'gender', 'interestedIn', 'photos']);

/** The signed-in user's own profile. */
export const OwnProfile = z.strictObject({
  userId: PublicUserId,
  status: z.enum(['pending', 'active', 'hidden']),
  name: z.string().min(1).max(50).nullable(),
  gender: Gender.nullable(),
  interestedIn: z.array(Gender).max(3),
  bio: z.string().max(500).nullable(),
  age: z.int().min(AGE.MIN).max(AGE.MAX),
  minAge: z.int().min(AGE.MIN).max(AGE.MAX),
  maxAge: z.int().min(AGE.MIN).max(AGE.MAX),
  photos: z.array(OwnPhoto).max(6),
  sections: z.array(SectionEntry),
  missing: z.array(ProfileRequirement).describe('Empty when the profile is complete.'),
});

/**
 * A chat message. Identified by `(conversationId, seq)`; there is no separate message id.
 * Messages are only ever delivered to the two members of the conversation.
 */
export const Message = z.strictObject({
  conversationId: ConversationId,
  seq: Seq,
  clientMsgId: ClientMsgId,
  senderId: PublicUserId,
  kind: MessageKind,
  body: z.string().min(MESSAGE_BODY.MIN).max(MESSAGE_BODY.MAX),
  createdAt: Timestamp,
});
