-- Up Migration
-- Phase 14 (owner, ADR 0024): chat privacy settings. Read receipts are off unless the user
-- turns them on, and reciprocal (shown only when both members share). No row = the defaults.
-- Expand-only.
CREATE TABLE chat.member_settings (
  user_id uuid PRIMARY KEY,
  share_read_receipts boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE chat.member_settings;
