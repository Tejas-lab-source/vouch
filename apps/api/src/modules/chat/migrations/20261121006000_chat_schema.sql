-- Up Migration
CREATE SCHEMA chat;
GRANT USAGE ON SCHEMA chat TO vouch_chat;
ALTER DEFAULT PRIVILEGES IN SCHEMA chat
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vouch_chat;

-- One conversation per match (idempotent on match_id). The pair is copied from the match so
-- membership checks and per-user listings stay inside this schema. last_seq is incremented
-- with RETURNING when a message is inserted, giving a gapless per-conversation sequence.
CREATE TABLE chat.conversations (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL UNIQUE,
  user_low uuid NOT NULL,
  user_high uuid NOT NULL,
  last_seq bigint NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (user_low < user_high)
);
CREATE INDEX conversations_user_low ON chat.conversations (user_low);
CREATE INDEX conversations_user_high ON chat.conversations (user_high);
CREATE INDEX conversations_closed_at ON chat.conversations (closed_at) WHERE closed_at IS NOT NULL;

-- Hash-partitioned from the first migration (ADR 0005). kind lets later features add message
-- types without a migration. Retention: until account deletion, or closed_at + 30 days.
CREATE TABLE chat.messages (
  conversation_id uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  sender_id uuid NOT NULL,
  client_msg_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind ~ '^[a-z][a-z_]{0,39}$'),
  body text,
  media_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq),
  CONSTRAINT messages_client_msg_unique UNIQUE (conversation_id, client_msg_id),
  CHECK (body IS NOT NULL OR media_key IS NOT NULL)
) PARTITION BY HASH (conversation_id);

DO $$
BEGIN
  FOR n IN 0..15 LOOP
    EXECUTE format(
      'CREATE TABLE chat.messages_p%s PARTITION OF chat.messages '
      'FOR VALUES WITH (MODULUS 16, REMAINDER %s)', n, n);
  END LOOP;
END
$$;

-- Erasure of a deleted user's messages (Phase 9 consumer).
CREATE INDEX messages_sender ON chat.messages (sender_id);

-- One read cursor per user per conversation, not a row per message.
CREATE TABLE chat.read_cursors (
  conversation_id uuid NOT NULL REFERENCES chat.conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_seq bigint NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  last_delivered_seq bigint NOT NULL DEFAULT 0 CHECK (last_delivered_seq >= 0),
  PRIMARY KEY (conversation_id, user_id)
);

-- Down Migration
DROP SCHEMA chat CASCADE;
