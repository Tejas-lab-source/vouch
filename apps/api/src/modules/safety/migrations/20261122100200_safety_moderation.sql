-- Up Migration
-- Phase 10: moderation outcomes, the selfie of an ID-card review, repeat photo offences and the
-- indexes the moderation queue, ban expiry and account deletion need. Expand-only.
ALTER TABLE safety.reports
  ADD COLUMN resolution text CHECK (resolution IN ('dismiss', 'warn', 'hide', 'unhide', 'ban')),
  ADD COLUMN resolved_by uuid,
  ADD COLUMN resolution_note text CHECK (char_length(resolution_note) <= 500);
CREATE INDEX reports_reporter ON safety.reports (reporter_id);

ALTER TABLE safety.verification_reviews ADD COLUMN selfie_image_key text;
CREATE INDEX verification_reviews_user ON safety.verification_reviews (user_id);
CREATE INDEX verification_reviews_decided_at ON safety.verification_reviews (decided_at)
  WHERE id_image_key IS NOT NULL OR selfie_image_key IS NOT NULL;

CREATE INDEX bans_expiry ON safety.bans (expires_at)
  WHERE lifted_at IS NULL AND expires_at IS NOT NULL;
CREATE INDEX bans_created_at ON safety.bans (created_at);

-- Photos rejected by moderation, counted for repeat offences (30-day window).
CREATE TABLE safety.photo_rejections (
  upload_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  rejected_at timestamptz NOT NULL
);
CREATE INDEX photo_rejections_user ON safety.photo_rejections (user_id, rejected_at);

-- Down Migration
DROP TABLE safety.photo_rejections;
DROP INDEX safety.bans_created_at;
DROP INDEX safety.bans_expiry;
DROP INDEX safety.verification_reviews_decided_at;
DROP INDEX safety.verification_reviews_user;
ALTER TABLE safety.verification_reviews DROP COLUMN selfie_image_key;
DROP INDEX safety.reports_reporter;
ALTER TABLE safety.reports DROP COLUMN resolution_note, DROP COLUMN resolved_by,
  DROP COLUMN resolution;
