-- Up Migration
CREATE SCHEMA matching;
GRANT USAGE ON SCHEMA matching TO vouch_matching, vouch_views;
ALTER DEFAULT PRIVILEGES IN SCHEMA matching
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_matching;

-- Hash-partitioned from the first migration (ADR 0005). The partition key is inside the
-- primary key, as Postgres requires. direction: 1 = like, 0 = pass.
-- Retention: passes 30 days (nightly batched delete per partition); likes for the account's
-- lifetime. Likes are never deleted on unmatch, so the pair never reappears.
CREATE TABLE matching.swipes (
  swiper_id uuid NOT NULL,
  target_id uuid NOT NULL,
  direction smallint NOT NULL CHECK (direction IN (0, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (swiper_id, target_id),
  CHECK (swiper_id <> target_id)
) PARTITION BY HASH (swiper_id);

DO $$
BEGIN
  FOR n IN 0..15 LOOP
    EXECUTE format(
      'CREATE TABLE matching.swipes_p%s PARTITION OF matching.swipes '
      'FOR VALUES WITH (MODULUS 16, REMAINDER %s)', n, n);
  END LOOP;
END
$$;

CREATE INDEX swipes_likes_in ON matching.swipes (target_id, created_at) WHERE direction = 1;
CREATE INDEX swipes_passes_created ON matching.swipes (created_at) WHERE direction = 0;

-- A pair matches at most once, stored in canonical order. Unmatch is permanent: unmatched_at
-- is set and the row is never reused. On account deletion the deleted user's id is replaced
-- by a random tombstone id (re-ordered if needed) and anonymised_at is set.
CREATE TABLE matching.matches (
  id uuid PRIMARY KEY,
  user_low uuid NOT NULL,
  user_high uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  unmatched_at timestamptz,
  anonymised_at timestamptz,
  CONSTRAINT matches_canonical_order CHECK (user_low < user_high),
  CONSTRAINT matches_pair_unique UNIQUE (user_low, user_high)
);
CREATE INDEX matches_user_high ON matching.matches (user_high, created_at);
CREATE INDEX matches_user_low_created ON matching.matches (user_low, created_at);

-- Published views.
-- seen_v: every (swiper, target) the swiper has acted on, for excluding seen candidates.
CREATE VIEW matching.seen_v AS
  SELECT swiper_id, target_id FROM matching.swipes;
-- likes_in_v: incoming likes. In v1 only counts are exposed to users (who-liked-you is a
-- later premium feature), but discovery may use the rows for ranking.
CREATE VIEW matching.likes_in_v AS
  SELECT target_id AS user_id, swiper_id, created_at
  FROM matching.swipes
  WHERE direction = 1;
GRANT SELECT ON matching.seen_v, matching.likes_in_v TO vouch_views;
-- Published views are read-only for everyone, including the owning module.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON matching.seen_v, matching.likes_in_v FROM vouch_matching;

-- Down Migration
DROP SCHEMA matching CASCADE;
