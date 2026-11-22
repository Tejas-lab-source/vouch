// @ts-check
import { z } from 'zod';
import { AGE, Gender, InterestedIn } from '../common/codes.js';
import { PhotoId } from '../common/ids.js';
import { OwnProfile, SectionEntry } from '../common/entities.js';
import { SectionType } from '../sections/index.js';
import { defineEndpoint } from './endpoint.js';

export const getMyProfile = defineEndpoint({
  id: 'getMyProfile',
  module: 'profiles',
  method: 'GET',
  path: '/v1/me/profile',
  auth: 'user',
  summary: 'Read the signed-in user’s own profile.',
  response: { status: 200, schema: OwnProfile },
});

const Age = z.int().min(AGE.MIN).max(AGE.MAX);

export const updateMyProfile = defineEndpoint({
  id: 'updateMyProfile',
  module: 'profiles',
  method: 'PATCH',
  path: '/v1/me/profile',
  auth: 'user',
  summary: 'Edit profile fields and preferences. Send only the fields that change.',
  body: z
    .strictObject({
      name: z.string().trim().min(1).max(50).optional(),
      gender: Gender.optional(),
      interestedIn: InterestedIn.optional(),
      bio: z.string().max(500).nullable().optional(),
      minAge: Age.optional(),
      maxAge: Age.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, 'send at least one field')
    .refine(
      (body) =>
        body.minAge === undefined || body.maxAge === undefined || body.minAge <= body.maxAge,
      'minAge must not exceed maxAge',
    ),
  response: { status: 200, schema: OwnProfile },
});

export const putProfileSection = defineEndpoint({
  id: 'putProfileSection',
  module: 'profiles',
  method: 'PUT',
  path: '/v1/me/profile/sections/{type}',
  auth: 'user',
  summary: 'Create or replace one profile section (extension point 9).',
  description: 'No section types exist in v1, so every type returns UNKNOWN_SECTION_TYPE.',
  params: z.strictObject({ type: SectionType }),
  body: z.strictObject({
    schemaVersion: z.int().min(1),
    position: z.int().min(0).max(50),
    data: z.unknown(),
  }),
  response: { status: 200, schema: SectionEntry },
  errors: ['UNKNOWN_SECTION_TYPE'],
});

export const deleteMyPhoto = defineEndpoint({
  id: 'deleteMyPhoto',
  module: 'profiles',
  method: 'DELETE',
  path: '/v1/me/photos/{id}',
  auth: 'user',
  summary: 'Remove one of your photos (pending, approved or rejected) and its stored files.',
  description:
    'Idempotent: deleting a photo that is already gone returns the current profile. A photo still being processed is discarded when processing ends.',
  params: z.strictObject({ id: PhotoId }),
  response: { status: 200, schema: OwnProfile },
});

export const profilesEndpoints = [getMyProfile, updateMyProfile, putProfileSection, deleteMyPhoto];
