# 0003 — One Postgres schema and role per module

- Status: Accepted (by owner on 2026-11-21, Phase 2 start plan, decision 6)
- Phase: 2

## Context

Vouch is a modular monolith (`docs/ARCHITECTURE.md` ADR-1 and 7.1). Module boundaries are
enforced in code by dependency-cruiser, but a shared database lets any module read or write any
table, which would erode those boundaries quietly. Splitting into services later is also much
easier when each module already owns its data.

## Decision

- Each module owns one schema of the same name: `platform`, `identity`, `profiles`, `media`,
  `safety`, `matching`, `chat`, `notifications`, `admin`. Discovery owns no tables.
- Each module has a `NOLOGIN` role, `vouch_<module>`, that can read and write only its own
  schema. Role names carry the `vouch_` prefix because roles are cluster-wide.
- A group role, `vouch_views`, holds `SELECT` on every published view (`*_v`). Every module role
  and `vouch_discovery` is a member; `vouch_discovery` has no other privilege.
- Published views are read-only for everyone, including the owning module.
- Every module role also gets `INSERT` on `platform.outbox`, `SELECT`/`INSERT` on
  `platform.inbox`, `SELECT` on `platform.feature_flags` and `SELECT`/`INSERT`/`UPDATE` on
  `platform.deletion_tasks`, so the Phase 4 unit of work can write events in the module's own
  transaction.
- Migrations run as an owner role that may create schemas and roles. Each environment's login
  users are granted membership in the module roles outside migrations (Phase 15).

## Alternatives considered

- **One shared schema:** simplest, but no database-level ownership; rejected in
  ARCHITECTURE.md ADR-2.
- **Strictly own-schema-only roles (no outbox grants):** matches the wording of
  ARCHITECTURE.md 7.1, but then events could not be written atomically with the change, which
  breaks the outbox guarantee (6.5).
- **A separate database per module:** loses single-transaction outbox writes and adds
  operational cost far too early.

## Consequences

- A bug or compromised module cannot read another module's private tables.
- Hosted Postgres must allow `CREATE ROLE` for the migration user (Render Postgres and Neon
  allow it for the owner role; to be confirmed in Phase 15).
- Discovery's event consumption and `deck.served.v1` emission must go through a role that has
  outbox and inbox access (`vouch_platform`), because `vouch_discovery` reads views only.
  Phase 4 and Phase 7 must wire this.
- The privilege matrix is tested exhaustively in `apps/api/test/db/roles.test.js`.
