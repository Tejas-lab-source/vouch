-- Up Migration
CREATE SCHEMA identity;
GRANT USAGE ON SCHEMA identity TO vouch_identity, vouch_views;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_identity;

-- No plaintext email anywhere: email_hmac = HMAC-SHA256(server secret, normalised email).
-- 18+ is enforced here as well as in the domain: birth_date must be at least 18 years
-- before the (UTC) sign-up date. Under-18 sign-ups are refused and never stored.
CREATE TABLE identity.users (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{16,32}$'),
  college_id uuid NOT NULL,
  email_hmac bytea NOT NULL UNIQUE CHECK (octet_length(email_hmac) = 32),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pending_review', 'active', 'banned', 'deleted')),
  birth_date date NOT NULL,
  grad_year smallint CHECK (grad_year BETWEEN 2000 AND 2100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_adult_at_signup
    CHECK (birth_date <= ((created_at AT TIME ZONE 'UTC')::date - interval '18 years')),
  CONSTRAINT users_deleted_status CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);
CREATE INDEX users_college ON identity.users (college_id);
CREATE INDEX users_deleted_at ON identity.users (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE identity.devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  push_token text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX devices_user ON identity.devices (user_id);
CREATE UNIQUE INDEX devices_push_token ON identity.devices (push_token)
  WHERE push_token IS NOT NULL AND revoked_at IS NULL;

-- Refresh tokens: stored only as a hash, one active token per device, rotated on every use.
-- Reuse of a rotated token revokes every session that shares its family_id.
CREATE TABLE identity.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES identity.devices (id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  replaced_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user ON identity.auth_sessions (user_id);
CREATE INDEX auth_sessions_family ON identity.auth_sessions (family_id);
CREATE INDEX auth_sessions_device ON identity.auth_sessions (device_id);
CREATE INDEX auth_sessions_expires ON identity.auth_sessions (expires_at);

-- Consent records (DPDP, ARCHITECTURE.md 11.4): one row per notice version accepted.
CREATE TABLE identity.consents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  notice_version text NOT NULL CHECK (char_length(notice_version) BETWEEN 1 AND 40),
  purposes text[] NOT NULL CHECK (cardinality(purposes) > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
);
CREATE INDEX consents_user ON identity.consents (user_id, granted_at);

-- Published view: users who may appear to others (not pending, banned or deleted).
CREATE VIEW identity.active_users_v AS
  SELECT id, public_id, college_id
  FROM identity.users
  WHERE status = 'active' AND deleted_at IS NULL;
GRANT SELECT ON identity.active_users_v TO vouch_views;
-- Published views are read-only for everyone, including the owning module.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON identity.active_users_v FROM vouch_identity;

-- Down Migration
DROP SCHEMA identity CASCADE;
