-- Up Migration
CREATE SCHEMA admin;
GRANT USAGE ON SCHEMA admin TO vouch_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_admin;

-- Moderator and admin accounts (Phase 10). The TOTP secret is stored encrypted by the app;
-- email is stored only as an HMAC, like identity.users.
CREATE TABLE admin.admin_users (
  id uuid PRIMARY KEY,
  email_hmac bytea NOT NULL UNIQUE CHECK (octet_length(email_hmac) = 32),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  role text NOT NULL CHECK (role IN ('moderator', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  totp_secret_enc bytea,
  mfa_enabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CHECK ((mfa_enabled_at IS NULL) OR (totp_secret_enc IS NOT NULL))
);

-- Append-only record of every admin action. No foreign key to admin_users so entries survive
-- account removal. Retention: 2 years.
CREATE TABLE admin.audit_log (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action ~ '^[a-z]+(\.[a-z_]+)+$'),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 40),
  target_id text NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 64),
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at ON admin.audit_log (created_at);
CREATE INDEX audit_log_target ON admin.audit_log (target_type, target_id, created_at);
CREATE INDEX audit_log_actor ON admin.audit_log (actor_id, created_at);
-- Append-only: entries can be inserted and purged by retention, never edited.
REVOKE UPDATE ON admin.audit_log FROM vouch_admin;

-- Down Migration
DROP SCHEMA admin CASCADE;
