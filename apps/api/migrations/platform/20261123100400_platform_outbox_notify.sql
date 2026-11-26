-- Up Migration
-- Phase 15: the outbox relay wakes on NOTIFY instead of waiting for its 2 s idle poll.
-- One notification per inserting statement, delivered when the transaction commits
-- (Postgres folds identical notifications within a transaction into one). The poll stays as
-- the fallback, so a missed notification only delays an event, never loses it.
CREATE FUNCTION platform.notify_outbox() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('platform_outbox', '');
  RETURN NULL;
END;
$$;

CREATE TRIGGER outbox_notify AFTER INSERT ON platform.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION platform.notify_outbox();

-- Down Migration
DROP TRIGGER outbox_notify ON platform.outbox;
DROP FUNCTION platform.notify_outbox();
