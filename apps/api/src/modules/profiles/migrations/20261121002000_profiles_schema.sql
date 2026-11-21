-- Up Migration
CREATE SCHEMA profiles;
GRANT USAGE ON SCHEMA profiles TO vouch_profiles, vouch_views;
ALTER DEFAULT PRIVILEGES IN SCHEMA profiles
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_profiles;

-- An empty profile is created from user.created.v1 (Phase 6), so name and gender start NULL;
-- an active profile must have them. birth_date is copied from identity for age filtering
-- (owner decision, Phase 2). Gender codes are defined in packages/contracts (Phase 3).
CREATE TABLE profiles.profiles (
  user_id uuid PRIMARY KEY,
  college_id uuid NOT NULL,
  cluster_id uuid NOT NULL,
  name text CHECK (char_length(name) BETWEEN 1 AND 50),
  gender smallint CHECK (gender >= 0),
  interested_in smallint[] NOT NULL DEFAULT '{}',
  bio text CHECK (char_length(bio) <= 500),
  birth_date date NOT NULL,
  min_age smallint NOT NULL DEFAULT 18,
  max_age smallint NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'hidden')),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_age_range CHECK (min_age >= 18 AND min_age <= max_age AND max_age <= 99),
  CONSTRAINT profiles_active_complete CHECK (
    status <> 'active'
    OR (name IS NOT NULL AND gender IS NOT NULL AND cardinality(interested_in) > 0)
  )
);
-- Candidate source (Phase 7): active profiles in one cluster, filtered by gender.
CREATE INDEX profiles_candidates ON profiles.profiles (cluster_id, gender, last_active_at DESC)
  WHERE status = 'active';

-- Photo metadata only; bytes live in R2. Object keys are set when the photo is approved.
CREATE TABLE profiles.photos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles.profiles (user_id) ON DELETE CASCADE,
  upload_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  key_1080 text,
  key_400 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photos_approved_has_keys
    CHECK (status <> 'approved' OR (key_1080 IS NOT NULL AND key_400 IS NOT NULL))
);
CREATE INDEX photos_user ON profiles.photos (user_id, position);

-- Extension point 9: new section types need no migration; data is validated by the
-- section's zod schema registered under the manifest key `sections`.
CREATE TABLE profiles.profile_sections (
  user_id uuid NOT NULL REFERENCES profiles.profiles (user_id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]{0,39}$'),
  schema_version smallint NOT NULL CHECK (schema_version > 0),
  data jsonb NOT NULL,
  position smallint NOT NULL CHECK (position >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);

-- Published view: what discovery needs to filter and score candidates. No names, bios or
-- photo keys: cards are hydrated later through profiles.api.getCards.
CREATE VIEW profiles.candidates_v AS
  SELECT
    p.user_id,
    p.college_id,
    p.cluster_id,
    p.gender,
    p.interested_in,
    p.birth_date,
    p.min_age,
    p.max_age,
    p.last_active_at,
    p.created_at,
    (SELECT count(*) FROM profiles.photos ph
      WHERE ph.user_id = p.user_id AND ph.status = 'approved') AS approved_photos
  FROM profiles.profiles p
  WHERE p.status = 'active';
GRANT SELECT ON profiles.candidates_v TO vouch_views;
-- Published views are read-only for everyone, including the owning module.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON profiles.candidates_v FROM vouch_profiles;

-- Down Migration
DROP SCHEMA profiles CASCADE;
