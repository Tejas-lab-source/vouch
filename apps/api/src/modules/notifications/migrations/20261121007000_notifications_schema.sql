-- Up Migration
CREATE SCHEMA notifications;
GRANT USAGE ON SCHEMA notifications TO vouch_notifications;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_notifications;

-- Push preferences and quiet hours. Quiet hours are minutes after local midnight in
-- `timezone`; both ends are set or neither is. A missing row means the defaults.
CREATE TABLE notifications.prefs (
  user_id uuid PRIMARY KEY,
  push_matches boolean NOT NULL DEFAULT true,
  push_messages boolean NOT NULL DEFAULT true,
  push_likes_digest boolean NOT NULL DEFAULT true,
  quiet_start_minute smallint CHECK (quiet_start_minute BETWEEN 0 AND 1439),
  quiet_end_minute smallint CHECK (quiet_end_minute BETWEEN 0 AND 1439),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_start_minute IS NULL) = (quiet_end_minute IS NULL))
);

-- Delivery log. Never stores message bodies. dedupe_key collapses batched pushes (for example
-- one message push per conversation per 30 s). Retention: 90 days.
CREATE TABLE notifications.deliveries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  template text NOT NULL CHECK (template ~ '^[a-z]+(\.[a-z_]+)*$'),
  channel text NOT NULL DEFAULT 'push' CHECK (channel IN ('push', 'email')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed', 'suppressed', 'cancelled')),
  dedupe_key text UNIQUE,
  provider_ticket_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX deliveries_user ON notifications.deliveries (user_id, created_at);
CREATE INDEX deliveries_created_at ON notifications.deliveries (created_at);

-- Down Migration
DROP SCHEMA notifications CASCADE;
