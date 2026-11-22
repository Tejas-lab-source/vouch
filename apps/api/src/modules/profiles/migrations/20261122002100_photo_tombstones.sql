-- Up Migration
-- Phase 6 (ADR 0012): a photo the owner deletes keeps a `deleted` row (a tombstone, no keys), so
-- a late photo.approved.v1 or photo.rejected.v1 for it cannot bring it back. Expand-only: the
-- old values stay valid.
ALTER TABLE profiles.photos DROP CONSTRAINT photos_status_check;
ALTER TABLE profiles.photos ADD CONSTRAINT photos_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'deleted'));

-- Down Migration
DELETE FROM profiles.photos WHERE status = 'deleted';
ALTER TABLE profiles.photos DROP CONSTRAINT photos_status_check;
ALTER TABLE profiles.photos ADD CONSTRAINT photos_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));
