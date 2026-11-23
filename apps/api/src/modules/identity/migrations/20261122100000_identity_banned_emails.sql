-- Up Migration
-- Ban evasion across deletion (Phase 10): while a ban is active, the banned account's email
-- HMAC is kept here, so an erased account cannot sign up again with the same email. No user id:
-- the row outlives the account. Removed when the ban is lifted or expires.
CREATE TABLE identity.banned_emails (
  ban_id uuid PRIMARY KEY,
  email_hmac bytea NOT NULL CHECK (octet_length(email_hmac) = 32),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX banned_emails_hmac ON identity.banned_emails (email_hmac);
CREATE INDEX banned_emails_expires_at ON identity.banned_emails (expires_at)
  WHERE expires_at IS NOT NULL;

-- Down Migration
DROP TABLE identity.banned_emails;
