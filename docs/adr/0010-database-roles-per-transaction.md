# 0010 — Module database roles: SET LOCAL ROLE per transaction

- Status: Accepted (by owner on 2026-11-21, Phase 4 decision 1)
- Phase: 4

## Context

Each module has a `NOLOGIN` Postgres role that can write only its own schema (ADR 0003). The
running process needs to use the right role for each module's queries. Per-connection startup
options (`options=-c role=…`) are ignored by hosted transaction poolers, and a pool per module
multiplies connections.

## Decision

- One login user per environment (`DATABASE_URL`), granted membership in every `vouch_<module>`
  role. Locally the Compose superuser plays that part; tests use a non-superuser login.
- One postgres.js pool. Every module query runs inside a transaction that starts with
  `SET LOCAL ROLE vouch_<module>` and `SET LOCAL statement_timeout` (5 s by default).
  - `uow.run` (writes) does this automatically.
  - `db.read(module, fn)` does the same for reads, with `SET TRANSACTION READ ONLY`.
  - `SET LOCAL` ends with the transaction, on commit or rollback, so a role never leaks to the next
    transaction on the same pooled connection.
- Module names are checked against an explicit list before the role is set.
- Per-module login URLs (`DATABASE_URL_<MODULE>`) remain a possible later option and are not
  built.

## Alternatives considered

- **Startup option `role=vouch_<module>` per pool:** ignored by transaction poolers (Neon,
  PgBouncer in transaction mode).
- **A pool and login per module:** ten pools and ten secrets per environment, and more
  connections than the beta database allows.
- **Session-level `SET ROLE`:** leaks across pooled transactions.

## Consequences

- Even single reads run in a short transaction (an extra round trip). This is acceptable at beta
  scale and keeps role enforcement uniform.
- Tests prove that a module cannot write another module's schema through the kernel, and that
  the role does not leak to the next transaction on the same connection (`max: 1`), including
  after a rollback.
- `public.pgmigrations` is readable by `vouch_platform` so `/ready` can check pending
  migrations.
