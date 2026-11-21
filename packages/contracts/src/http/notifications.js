// @ts-check
import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';

const MinuteOfDay = z.int().min(0).max(1439);

/** Push preferences; quiet hours are minutes after local midnight in `timezone`. */
export const NotificationPrefs = z.strictObject({
  pushMatches: z.boolean(),
  pushMessages: z.boolean(),
  pushLikesDigest: z.boolean(),
  quietHours: z
    .strictObject({ startMinute: MinuteOfDay, endMinute: MinuteOfDay })
    .nullable()
    .describe('Null for no quiet hours. May wrap past midnight (start > end).'),
  timezone: z.string().min(1).max(64).describe('IANA time zone, for example Asia/Kolkata.'),
});

export const putNotificationPrefs = defineEndpoint({
  id: 'putNotificationPrefs',
  module: 'notifications',
  method: 'PUT',
  path: '/v1/me/notification-prefs',
  auth: 'user',
  summary: 'Replace push preferences and quiet hours.',
  body: NotificationPrefs,
  response: { status: 200, schema: NotificationPrefs },
});

export const notificationsEndpoints = [putNotificationPrefs];
