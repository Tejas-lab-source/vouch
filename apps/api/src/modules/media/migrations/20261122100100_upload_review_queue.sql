-- Up Migration
-- The moderation queue (Phase 10) lists photos waiting for review, oldest first.
CREATE INDEX uploads_in_review ON media.uploads (id) WHERE status = 'in_review';

-- Down Migration
DROP INDEX media.uploads_in_review;
