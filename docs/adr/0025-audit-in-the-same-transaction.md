# 0025 — Every staff change is audited in its own transaction

- Status: Accepted (owner instruction, Phase 14). Changes the audit part of ADR 0018.
- Phase: 14

## Context

Until Phase 13, an admin action ran first and then wrote its `admin.audit_log` row in a
separate transaction. If the process died or the insert failed between the two, the action
had happened with no audit entry. The owner asked that this can never happen: the action and
its entry must be written in the same transaction, or via the outbox.

Most admin actions change another module's data (safety bans and reports, media photos,
profiles visibility, safety blocks). Each module has its own database role and may not write
`admin.audit_log`, so a single cross-schema transaction is not possible without breaking the
module boundaries.

## Decision

- **The event:** `audit.recorded.v1` (additive) `{ auditId, actorId, action, targetType,
targetId, details, requestId, occurredAt }`. Ids, codes and counts only; never notes or
  personal data.
- **Emitted where the change is made:** the admin action builds an audit trail
  (`platform/uow.js`: actor, request id) and passes it to the module API. That module calls
  `recordAudit(emit, trail, facts)` **inside the transaction that makes the change**. The
  change and the event therefore commit together or not at all.
- **Stored by admin:** admin subscribes to `audit.recorded.v1` and inserts the row with
  `id = auditId`, `ON CONFLICT DO NOTHING`. At-least-once delivery cannot create duplicates.
- **Admin's own changes** (feature flags, sign-in) insert the audit row directly in the same
  transaction as the change. A sign-in's entry is written in the transaction that spends the
  TOTP code.
- **Multi-step actions** audit every change they make, each in its own transaction. For
  example, a report resolved with a ban writes `ban.create` (with the ban) and `report.ban`
  (with the resolution). Acting on a report with hide writes `profile.hide` and `report.hide`.
  A partial failure can never leave a change without its entry.
- **A repeated ban lift** changes nothing, but it is still audited because it is the staff
  member's action. This keeps the earlier behaviour.
- **`ctx.audit`** (the trail passed to `safety.unblock`) is set only by in-process calls from
  admin, never from an HTTP request.
- **The admin console** reads the newest entry about the target before the action. Afterwards
  it polls briefly (up to about 3 s) until a newer entry is stored.

## Consequences

- An entry appears a moment after the action commits (one relay and consumer cycle, normally
  under a second), not at the instant the action returns.
- If the admin consumer is down, entries wait durably in the outbox and the consumer's retry
  queue. They are not lost.
- **The test** (`admin.integration.test.js`, "an action never happens without its audit
  entry"):
  - It adds a temporary CHECK constraint so the outbox refuses `audit.recorded.v1`. A ban then
    fails with 500 and leaves no ban and no entry.
  - It adds the same kind of constraint to `admin.audit_log` for `flag.put`. The flag edit then
    rolls back. On the old code the flag committed first, so this half of the test fails there.
  - Without the constraints, the same ban commits with exactly one entry.
