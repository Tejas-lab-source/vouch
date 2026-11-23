-- Up Migration
-- Phase 10: the nightly consistency job (platform/jobs/consistency.js) runs as vouch_platform
-- and counts cross-module invariant violations. It needs only ids, statuses and timestamps:
-- column-level grants, never message bodies, names or anything personal.
GRANT USAGE ON SCHEMA identity, profiles, media, safety, matching, chat, notifications
  TO vouch_platform;
GRANT SELECT (id, status, deleted_at) ON identity.users TO vouch_platform;
GRANT SELECT (user_id) ON profiles.profiles TO vouch_platform;
GRANT SELECT (user_id) ON profiles.photos TO vouch_platform;
GRANT SELECT (user_id) ON media.uploads TO vouch_platform;
GRANT SELECT (blocker_id, blocked_id) ON safety.blocks TO vouch_platform;
GRANT SELECT (user_id) ON safety.verification_reviews TO vouch_platform;
GRANT SELECT (id, user_low, user_high, created_at, unmatched_at, anonymised_at)
  ON matching.matches TO vouch_platform;
GRANT SELECT (swiper_id, target_id) ON matching.swipes TO vouch_platform;
GRANT SELECT (id) ON chat.conversations TO vouch_platform;
GRANT SELECT (sender_id) ON chat.messages TO vouch_platform;
GRANT SELECT (user_id) ON chat.read_cursors TO vouch_platform;
GRANT SELECT (user_id) ON notifications.prefs TO vouch_platform;
GRANT SELECT (user_id) ON notifications.deliveries TO vouch_platform;

-- Down Migration
REVOKE SELECT (user_id) ON notifications.deliveries FROM vouch_platform;
REVOKE SELECT (user_id) ON notifications.prefs FROM vouch_platform;
REVOKE SELECT (user_id) ON chat.read_cursors FROM vouch_platform;
REVOKE SELECT (sender_id) ON chat.messages FROM vouch_platform;
REVOKE SELECT (id) ON chat.conversations FROM vouch_platform;
REVOKE SELECT (swiper_id, target_id) ON matching.swipes FROM vouch_platform;
REVOKE SELECT (id, user_low, user_high, created_at, unmatched_at, anonymised_at)
  ON matching.matches FROM vouch_platform;
REVOKE SELECT (user_id) ON safety.verification_reviews FROM vouch_platform;
REVOKE SELECT (blocker_id, blocked_id) ON safety.blocks FROM vouch_platform;
REVOKE SELECT (user_id) ON media.uploads FROM vouch_platform;
REVOKE SELECT (user_id) ON profiles.photos FROM vouch_platform;
REVOKE SELECT (user_id) ON profiles.profiles FROM vouch_platform;
REVOKE SELECT (id, status, deleted_at) ON identity.users FROM vouch_platform;
REVOKE USAGE ON SCHEMA identity, profiles, media, safety, matching, chat, notifications
  FROM vouch_platform;
