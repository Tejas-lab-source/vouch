-- Up Migration
-- Phase 14: the consistency job checks every table that holds a user id for deleted accounts
-- (test/db/user-data.test.js keeps the list complete). Column-level: user ids only.
GRANT SELECT (user_id) ON chat.member_settings TO vouch_platform;
GRANT SELECT (user_low, user_high) ON chat.conversations TO vouch_platform;
GRANT SELECT (user_id) ON profiles.profile_sections TO vouch_platform;
GRANT SELECT (user_id) ON safety.photo_rejections TO vouch_platform;

-- Down Migration
REVOKE SELECT (user_id) ON safety.photo_rejections FROM vouch_platform;
REVOKE SELECT (user_id) ON profiles.profile_sections FROM vouch_platform;
REVOKE SELECT (user_low, user_high) ON chat.conversations FROM vouch_platform;
REVOKE SELECT (user_id) ON chat.member_settings FROM vouch_platform;
