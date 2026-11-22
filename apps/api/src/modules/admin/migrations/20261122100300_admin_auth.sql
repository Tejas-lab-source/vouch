-- Up Migration
-- Phase 10 (ADR 0018): admin sign-in is email + password (scrypt) + TOTP. The last accepted
-- TOTP time step is stored so a code cannot be used twice. Accounts are created only by the
-- `admin:create` script. Expand-only.
ALTER TABLE admin.admin_users
  ADD COLUMN password_hash text CHECK (password_hash IS NULL OR password_hash LIKE 'scrypt$%'),
  ADD COLUMN last_totp_step bigint NOT NULL DEFAULT 0;

-- Admins edit feature flags (GET/PUT /v1/admin/flags).
GRANT INSERT, UPDATE ON platform.feature_flags TO vouch_admin;

-- Down Migration
REVOKE INSERT, UPDATE ON platform.feature_flags FROM vouch_admin;
ALTER TABLE admin.admin_users DROP COLUMN last_totp_step, DROP COLUMN password_hash;
