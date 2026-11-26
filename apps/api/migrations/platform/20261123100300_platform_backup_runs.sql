-- Up Migration
-- Phase 15: one row per successful nightly backup (scripts/backup.js, a Render Cron Job). The
-- API exports the age of the newest one as vouch_backup_age_seconds; an alert fires above 26 h.
-- Written by the backup job (the migration owner's connection); read by vouch_platform.
CREATE TABLE platform.backup_runs (
  id bigserial PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  object_key text NOT NULL CHECK (object_key LIKE 'backups/%'),
  bytes bigint NOT NULL CHECK (bytes > 0),
  taken_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backup_runs_taken_at ON platform.backup_runs (taken_at DESC);
GRANT SELECT ON platform.backup_runs TO vouch_platform;

-- Down Migration
DROP TABLE platform.backup_runs;
