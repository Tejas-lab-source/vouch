-- Up Migration
-- Cluster-wide NOLOGIN roles, one per module (ADR 0003). Each environment's login users are
-- granted membership in these roles outside migrations (Phase 15); tests use SET ROLE.
-- vouch_views is a group role: members may read every published *_v view.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'vouch_views', 'vouch_platform', 'vouch_identity', 'vouch_profiles', 'vouch_media',
    'vouch_safety', 'vouch_matching', 'vouch_chat', 'vouch_notifications', 'vouch_admin',
    'vouch_discovery'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT', role_name);
    END IF;
  END LOOP;
END
$$;

-- Module roles read published views through membership in vouch_views.
GRANT vouch_views TO vouch_platform, vouch_identity, vouch_profiles, vouch_media, vouch_safety,
  vouch_matching, vouch_chat, vouch_notifications, vouch_admin, vouch_discovery;

-- Down Migration
-- Runs last on the way down, after every schema (and its grants) is gone.
DROP ROLE IF EXISTS vouch_discovery, vouch_admin, vouch_notifications, vouch_chat,
  vouch_matching, vouch_safety, vouch_media, vouch_profiles, vouch_identity, vouch_platform,
  vouch_views;
