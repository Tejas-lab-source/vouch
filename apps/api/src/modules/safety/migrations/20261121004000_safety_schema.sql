-- Up Migration
CREATE SCHEMA safety;
GRANT USAGE ON SCHEMA safety TO vouch_safety, vouch_views;
ALTER DEFAULT PRIVILEGES IN SCHEMA safety
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_safety;

-- A block is directional in storage and symmetric for visibility (see block_pairs_v).
CREATE TABLE safety.blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON safety.blocks (blocked_id);

-- evidence is a snapshot taken at report time (profile card; last 20 messages for chat
-- reports). Retention: purged 1 year after closed_at.
CREATE TABLE safety.reports (
  id uuid PRIMARY KEY,
  reporter_id uuid NOT NULL,
  target_id uuid NOT NULL,
  context text NOT NULL CHECK (context IN ('profile', 'chat')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 60),
  evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (reporter_id <> target_id),
  CONSTRAINT reports_closed_state CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE INDEX reports_queue ON safety.reports (status, created_at);
-- Auto-hide threshold (Phase 10): distinct reporters per target in the last 7 days.
CREATE INDEX reports_target ON safety.reports (target_id, created_at);
CREATE INDEX reports_closed_at ON safety.reports (closed_at) WHERE closed_at IS NOT NULL;

-- At most one active ban per user. Retention: kept while active.
CREATE TABLE safety.bans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);
CREATE UNIQUE INDEX bans_active_user ON safety.bans (user_id) WHERE lifted_at IS NULL;

-- ID-card fallback queue. The image object (id_image_key) is deleted 30 days after the
-- decision; the decision row stays as the record of verification.
CREATE TABLE safety.verification_reviews (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  id_image_key text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_reason text CHECK (char_length(decision_reason) <= 500),
  CONSTRAINT verification_reviews_decided
    CHECK ((status = 'pending') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL))
);
CREATE INDEX verification_reviews_queue ON safety.verification_reviews (status, submitted_at);
CREATE UNIQUE INDEX verification_reviews_one_pending ON safety.verification_reviews (user_id)
  WHERE status = 'pending';

-- Published view: every blocked pair in both directions, so readers can exclude either side
-- with a single lookup.
CREATE VIEW safety.block_pairs_v AS
  SELECT blocker_id AS user_id, blocked_id AS other_id FROM safety.blocks
  UNION ALL
  SELECT blocked_id AS user_id, blocker_id AS other_id FROM safety.blocks;
GRANT SELECT ON safety.block_pairs_v TO vouch_views;
-- Published views are read-only for everyone, including the owning module.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON safety.block_pairs_v FROM vouch_safety;

-- Down Migration
DROP SCHEMA safety CASCADE;
