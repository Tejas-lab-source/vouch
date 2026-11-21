-- Up Migration
-- Owner decision (Phase 4): vouch_discovery gets the same event-table access as every other
-- module role, so its consumers deduplicate and it emits deck.served.v1 through the kernel.
GRANT INSERT ON platform.outbox TO vouch_discovery;
GRANT USAGE ON SEQUENCE platform.outbox_id_seq TO vouch_discovery;
GRANT SELECT, INSERT ON platform.inbox TO vouch_discovery;
GRANT SELECT ON platform.feature_flags TO vouch_discovery;
GRANT SELECT, INSERT, UPDATE ON platform.deletion_tasks TO vouch_discovery;

-- emit() uses INSERT ... RETURNING id, which needs SELECT on the returned column. A column-level
-- grant exposes only the id: event payloads stay unreadable to module roles.
GRANT SELECT (id) ON platform.outbox TO vouch_identity, vouch_profiles, vouch_media, vouch_safety,
  vouch_matching, vouch_chat, vouch_notifications, vouch_admin, vouch_discovery;

-- Readiness (/ready) checks that every migration has run, as the platform role.
GRANT SELECT ON public.pgmigrations TO vouch_platform;

-- Down Migration
REVOKE SELECT (id) ON platform.outbox FROM vouch_identity, vouch_profiles, vouch_media,
  vouch_safety, vouch_matching, vouch_chat, vouch_notifications, vouch_admin, vouch_discovery;
REVOKE SELECT ON public.pgmigrations FROM vouch_platform;
REVOKE SELECT, INSERT, UPDATE ON platform.deletion_tasks FROM vouch_discovery;
REVOKE SELECT ON platform.feature_flags FROM vouch_discovery;
REVOKE SELECT, INSERT ON platform.inbox FROM vouch_discovery;
REVOKE USAGE ON SEQUENCE platform.outbox_id_seq FROM vouch_discovery;
REVOKE INSERT ON platform.outbox FROM vouch_discovery;
