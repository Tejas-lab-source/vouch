-- Up Migration
-- Phase 7 (ADR 0013): a photo moderation sends to human review waits as `in_review`, with its
-- variants under the private `review/` prefix, until the moderation queue (Phase 10) decides.
-- Expand-only.
ALTER TABLE media.uploads DROP CONSTRAINT uploads_status_check;
ALTER TABLE media.uploads ADD CONSTRAINT uploads_status_check CHECK (status IN
  ('pending', 'uploaded', 'processing', 'in_review', 'approved', 'rejected', 'expired'));

-- Down Migration
UPDATE media.uploads SET status = 'processing' WHERE status = 'in_review';
ALTER TABLE media.uploads DROP CONSTRAINT uploads_status_check;
ALTER TABLE media.uploads ADD CONSTRAINT uploads_status_check CHECK (status IN
  ('pending', 'uploaded', 'processing', 'approved', 'rejected', 'expired'));
