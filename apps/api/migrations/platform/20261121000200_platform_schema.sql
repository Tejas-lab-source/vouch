-- Up Migration
CREATE SCHEMA platform;
GRANT USAGE ON SCHEMA platform TO vouch_platform, vouch_views,
  vouch_identity, vouch_profiles, vouch_media, vouch_safety, vouch_matching, vouch_chat,
  vouch_notifications, vouch_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT USAGE, SELECT ON SEQUENCES TO vouch_platform;

CREATE TABLE platform.campus_clusters (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 100),
  city text NOT NULL CHECK (char_length(city) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.colleges (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email_domains text[] NOT NULL CHECK (cardinality(email_domains) > 0),
  cluster_id uuid NOT NULL REFERENCES platform.campus_clusters (id),
  city text NOT NULL CHECK (char_length(city) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX colleges_cluster ON platform.colleges (cluster_id);
CREATE INDEX colleges_email_domains ON platform.colleges USING gin (email_domains);

-- Transactional outbox (ADR-3 in ARCHITECTURE.md). Written in the same transaction as the
-- change that caused the event; the relay (Phase 4) publishes unpublished rows.
CREATE TABLE platform.outbox (
  id bigserial PRIMARY KEY,
  name text NOT NULL CHECK (name ~ '^[a-z]+(\.[a-z_]+)+\.v[0-9]+$'),
  version smallint NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON platform.outbox (id) WHERE published_at IS NULL;
CREATE INDEX outbox_published_at ON platform.outbox (published_at) WHERE published_at IS NOT NULL;

-- Consumer deduplication: one row per (consumer, event) processed.
CREATE TABLE platform.inbox (
  consumer text NOT NULL,
  event_id bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
CREATE INDEX inbox_processed_at ON platform.inbox (processed_at);

CREATE TABLE platform.feature_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  enabled boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rules) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Account deletion tracking (Phase 10): one row per module that must erase a deleted user.
CREATE TABLE platform.deletion_tasks (
  user_id uuid NOT NULL,
  module text NOT NULL CHECK (module ~ '^[a-z]+$'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, module)
);
CREATE INDEX deletion_tasks_open ON platform.deletion_tasks (requested_at) WHERE completed_at IS NULL;

-- Every module writes events and deduplicates consumers in its own transaction (Phase 4 uow),
-- so module roles get narrow access to the event tables and read access to flags.
GRANT INSERT ON platform.outbox TO vouch_identity, vouch_profiles, vouch_media, vouch_safety,
  vouch_matching, vouch_chat, vouch_notifications, vouch_admin;
GRANT USAGE ON SEQUENCE platform.outbox_id_seq TO vouch_identity, vouch_profiles, vouch_media,
  vouch_safety, vouch_matching, vouch_chat, vouch_notifications, vouch_admin;
GRANT SELECT, INSERT ON platform.inbox TO vouch_identity, vouch_profiles, vouch_media,
  vouch_safety, vouch_matching, vouch_chat, vouch_notifications, vouch_admin;
GRANT SELECT ON platform.feature_flags TO vouch_identity, vouch_profiles, vouch_media,
  vouch_safety, vouch_matching, vouch_chat, vouch_notifications, vouch_admin;
GRANT INSERT, UPDATE ON platform.deletion_tasks TO vouch_identity, vouch_profiles, vouch_media,
  vouch_safety, vouch_matching, vouch_chat, vouch_notifications, vouch_admin;
GRANT SELECT ON platform.deletion_tasks TO vouch_identity, vouch_profiles, vouch_media,
  vouch_safety, vouch_matching, vouch_chat, vouch_notifications, vouch_admin;

-- Published view: active colleges, used for email-domain matching and clustering.
CREATE VIEW platform.colleges_v AS
  SELECT id, name, email_domains, cluster_id, city
  FROM platform.colleges
  WHERE active;
GRANT SELECT ON platform.colleges_v TO vouch_views;
-- Published views are read-only for everyone, including the owning module.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.colleges_v FROM vouch_platform;

-- Down Migration
DROP SCHEMA platform CASCADE;
