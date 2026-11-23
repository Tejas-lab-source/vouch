# Runbook: restore

Beta targets (ARCHITECTURE §12.5): lose at most **24 hours** of data and be back within
**4 hours**. Run a restore drill every month into a scratch database, and record the time in
the table at the end.

## What is backed up

| Data                          | Where                                                         | Backup                                                                              |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Postgres (everything durable) | Managed Postgres                                              | The host's daily backups, plus a nightly `pg_dump` to R2 (Phase 15)                 |
| Photos                        | R2 `photos/` (public variants), `uploads/` (raw, short-lived) | R2 durability; variants can be re-derived from nothing else, so treat R2 as primary |
| ID-card images                | R2 private prefix, deleted within 30 days                     | Not backed up, by design (data minimisation)                                        |
| Redis                         | Rate limits, presence, caches, queues                         | Not backed up: rebuilt; jobs are re-driven from the outbox                          |

## Restore Postgres

1. **Declare an incident** (`incident.md`, SEV-1). Stop writes by scaling the API to zero, or
   by putting it in maintenance with the `maintenance` flag. This avoids a split history.
2. **Choose the restore point:** the latest backup before the damage. Write down the time:
   everything after it is lost and must be told to users if personal data changed.
3. **Restore into a new database** (never over the damaged one):
   - **Host backup:** create a database from the backup or point in time in the host's
     console.
   - **`pg_dump`:**
     `pg_restore --no-owner --role=vouch_migrator -d "$NEW_DATABASE_URL" dump.pgdump`
4. **Migrate:** `node migrations/run.js up` from the current image. This is a no-op when the
   dump is current, and applies newer migrations otherwise.
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

| Date | Backup age | Restore time | Verified by | Notes                                          |
| ---- | ---------- | ------------ | ----------- | ---------------------------------------------- |
|      |            |              |             | First drill due in Phase 15, on the real host. |
