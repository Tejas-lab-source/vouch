-- Up Migration
-- Invite-only beta (Phase 15). A college with the `beta.invite_only` flag on (a campus rule)
-- accepts new sign-ups only with a valid invite code. Codes are random (80 bits) and stored
-- as SHA-256 hashes only; the plaintext is printed once by scripts/invite-create.js.
-- `uses` is incremented in the sign-up transaction, guarded by max_uses and expires_at.
-- No FK to platform.colleges: modules do not reference each other's tables.
CREATE TABLE identity.invite_codes (
  id uuid PRIMARY KEY,
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  college_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  max_uses integer CHECK (max_uses > 0),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND (max_uses IS NULL OR uses <= max_uses)),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_codes_college ON identity.invite_codes (college_id);

-- Which code admitted the account (null for accounts created without one).
ALTER TABLE identity.users ADD COLUMN invite_code_id uuid REFERENCES identity.invite_codes (id);
CREATE INDEX users_invite_code ON identity.users (invite_code_id) WHERE invite_code_id IS NOT NULL;

-- Down Migration
ALTER TABLE identity.users DROP COLUMN invite_code_id;
DROP TABLE identity.invite_codes;
