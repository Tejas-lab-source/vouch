# Runbook: restore

Beta targets (ARCHITECTURE §12.5): lose at most **24 hours** of data and be back within
**4 hours**. Run a restore drill every month into a scratch database, and record the time in
the table at the end.

## What is backed up

| Data                          | Where                                                         | Backup                                                                              |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Postgres (everything durable) | Render Postgres                                               | Render's daily backups, plus a nightly `pg_dump` to R2 `backups/<env>/` (14 days)   |
| Photos                        | R2 `photos/` (public variants), `uploads/` (raw, short-lived) | R2 durability; variants can be re-derived from nothing else, so treat R2 as primary |
| ID-card images                | R2 private prefix, deleted within 30 days                     | Not backed up, by design (data minimisation)                                        |
| Redis                         | Rate limits, presence, caches, queues                         | Not backed up: rebuilt; jobs are re-driven from the outbox                          |

## Restore Postgres

1. **Declare an incident** (`incident.md`, SEV-1). Stop writes by scaling the API to zero, or
   by putting it in maintenance with the `maintenance` flag. This avoids a split history.
2. **Choose the restore point:** the latest backup before the damage. Write down the time:
   everything after it is lost and must be told to users if personal data changed.
3. **Restore into a new database** (never over the damaged one). In Render, create a new
   Postgres (same plan and region), then either:
   - **Render's backup:** Render → the database → Recovery → restore a point in time into a
     new instance. Then run `node migrations/run.js up` against it from the API's shell
     (`DATABASE_URL=<new> node migrations/run.js up`): it applies newer migrations and grants
     the module roles to the new login.
   - **The nightly dump** (tested by `apps/api/test/scripts/restore.integration.test.js`), in
     the API's Render shell:

         node scripts/backup.js fetch latest /tmp/restore.pgdump
         RESTORE_DATABASE_URL=<new database URL> node scripts/backup.js restore /tmp/restore.pgdump
         rm /tmp/restore.pgdump

     `fetch` takes `latest` or a key (`backups/production/<time>.dump`). `restore` refuses
     the live `DATABASE_URL`. It creates the module roles on the new instance, restores
     everything except the dump's default privileges (they name the old owner), runs
     `migrate up` and re-applies the default privileges as the new owner.
4. **Write down the restore time** and the backup's age, for the log below.
5. **Verify** before switching:
   - `/ready` passes against the new database (it checks migrations)
   - row counts per module are plausible
   - the consistency check (`platform.consistencyTick`) reports 0 violations
   - `SELECT count(*) FROM platform.outbox WHERE published_at IS NULL` is small
6. **Switch:** point `DATABASE_URL` at the new database and start the API.
   - The relay publishes any unpublished outbox rows.
   - Consumers skip events already in the inbox.
7. **Redis:** flush it (`FLUSHALL`). This removes stale presence, caches and queue state
   from after the restore point.
   - Rate limits and caches refill.
   - Clients reconnect and resync with `sync`.
8. **Re-run erasures.** Account deletions requested after the restore point must not come
   back. Before reopening, re-apply them from the host logs of `DELETE /v1/me` and the
   `user.deleted.v1` events after the restore point. Until that is done, the consistency
   check reports `deleted_users_with_data`.
9. **Tell users** if their data from after the restore point is lost (messages, matches).

## Restore drill log

| Date       | Backup age | Restore time | Verified by            | Notes                                                                                                  |
| ---------- | ---------- | ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 2026-11-23 | minutes    | 2 s          | automated test (local) | Rehearsal of the procedure on Postgres 17 containers, as a non-superuser login. Not the real host yet. |
|            |            |              |                        | First drill on Render: Phase 15, once staging exists (B2, B4).                                         |
