# 0006 — No foreign keys across module schemas

- Status: Accepted (by owner on 2026-11-21, Phase 2 start plan)
- Phase: 2

## Context

Foreign keys across module schemas would couple modules at the database level: a migration in
one module could break another, deletes would cascade across ownership boundaries, and the
schemas could never be moved to separate databases. Foreign keys on very large tables also add
write cost and lock contention.

## Decision

- No foreign key references a table in another schema. A column such as `profiles.user_id` is a
  plain `uuid` that refers to `identity.users.id` by convention.
- Cross-module consistency comes from domain events (`user.deleted.v1` drives every module's
  erase handler), the published views, and the nightly consistency job (Phase 10), which counts
  orphans and alerts above zero.
- Foreign keys are allowed inside one schema, on low-volume tables only. The v1 set is:
  `platform.colleges → campus_clusters`; `identity.devices`, `auth_sessions` and `consents →
users`; `identity.auth_sessions → devices`; `profiles.photos` and `profile_sections →
profiles`; `chat.read_cursors → conversations`.
- The high-volume tables (`matching.swipes`, `chat.messages`, `platform.outbox`,
  `notifications.deliveries`, `admin.audit_log`) have no foreign keys at all.

## Alternatives considered

- **Foreign keys everywhere:** strongest integrity, but couples modules and makes high-volume
  writes slower.
- **No foreign keys at all:** loses cheap integrity inside a module where coupling is not a
  concern.

## Consequences

- Orphans across modules are possible for a short time (until an event is consumed) and must be
  tolerated by readers, for example by filtering through `identity.active_users_v`.
- Erasure correctness depends on every module's `user.deleted.v1` consumer; Phase 10 tracks it in
  `platform.deletion_tasks`.
