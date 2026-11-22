-- Up Migration
-- Phase 6 (ADR 0012): the random key of a photo's public variants,
-- photos/{photo_key}/{id}_{size}.webp. Chosen when processing starts and reused on retries, so a
-- retried job overwrites the same objects instead of leaving orphans. Expand-only.
ALTER TABLE media.uploads ADD COLUMN photo_key text CHECK (photo_key ~ '^[A-Za-z0-9_-]{22}$');

-- Down Migration
ALTER TABLE media.uploads DROP COLUMN photo_key;
