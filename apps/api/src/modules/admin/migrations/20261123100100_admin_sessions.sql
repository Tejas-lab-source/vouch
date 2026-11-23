-- Up Migration
-- Phase 14: admin sessions. Every admin token carries a session id (`sid`). Every admin
-- request checks that the session exists, belongs to the staff member, is not revoked and has
-- not expired, so logout and revocation take effect at once. Expand-only.
CREATE TABLE admin.sessions (
  id uuid PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES admin.admin_users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_admin ON admin.sessions (admin_id) WHERE revoked_at IS NULL;

-- Down Migration
DROP TABLE admin.sessions;
