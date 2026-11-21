-- Up Migration
CREATE SCHEMA media;
GRANT USAGE ON SCHEMA media TO vouch_media;
ALTER DEFAULT PRIVILEGES IN SCHEMA media
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_media;

-- One row per presigned upload (Phase 6). Photo bytes never pass through the API; the raw
-- object at raw_key is deleted by an R2 lifecycle rule after 1 day.
CREATE TABLE media.uploads (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  raw_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  max_bytes integer NOT NULL CHECK (max_bytes BETWEEN 1 AND 10485760),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'processing', 'approved', 'rejected', 'expired')),
  photo_id uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  processed_at timestamptz
);
CREATE INDEX uploads_user ON media.uploads (user_id, created_at);
CREATE INDEX uploads_created_at ON media.uploads (created_at);

-- Down Migration
DROP SCHEMA media CASCADE;
