# 0007 — Contract versioning, ids exposed to clients, and contract tooling

- Status: Accepted (by owner on 2026-11-21, Phase 3 start plan)
- Phase: 3

## Context

Backend and frontend are built against `packages/contracts`, frozen before implementation.
Clients in the field (mobile builds) cannot all be updated at once, so a contract change that
breaks an old client or a not-yet-updated consumer must be caught before merge. The roadmap
(B.6) and `docs/ARCHITECTURE.md` (6.8, 9.1) say contracts are additive and URLs carry only public
ids, but only users have a `public_id` in the data model (ADR 0004).

## Decision

**Versioning**

- Contracts are additive. Nothing is removed or narrowed. Breaking changes ship as a new version
  beside the old one: a new REST route, `noun.verb.v2` for events, `<name>.v2` for socket events.
- The rules are listed in `packages/contracts/README.md` and enforced in CI by
  `scripts/contracts-diff.js`. It compares a JSON Schema snapshot of every contract
  (`packages/contracts/schemas.json`) with the one on `main`. Inputs (requests, client socket
  events, jobs, pipeline inputs) may not narrow. Outputs (responses, acks, server events, domain
  events, config) may not remove fields, make required fields optional, change types, or remove
  enum values or union options.
- `openapi.json` and `schemas.json` are generated (`pnpm contracts:generate`) and committed. CI
  fails when they are stale (`pnpm contracts:check`).

**Ids exposed to clients**

- Users are addressed only by their random `public_id`.
- Matches, conversations, uploads, the owner's own photos, and reports are addressed by their
  internal UUIDv7. Admin-only resources (bans, verification reviews, audit entries, flagged
  photos) are also addressed by UUIDv7.
- A message is identified by `(conversationId, seq)`; there is no message id.

**Tooling**

- OpenAPI 3.1 is generated with zod 4's built-in `z.toJSONSchema`, with no generator
  dependency. `@apidevtools/swagger-parser` (dev-only) validates the result.

## Alternatives considered

- **A `public_id` on every table:** more columns and lookups for no real gain. UUIDv7s are
  unguessable, so they allow no enumeration. The creation time they reveal is already known to
  both members of a match or conversation.
- **Diffing only `openapi.json`:** would miss socket events, domain events and jobs, which break
  consumers just as easily.
- **`zod-openapi` or `@asteasolutions/zod-to-openapi`:** extra dependencies for what zod 4 does
  natively.
- **An escape hatch for intentional breaking changes:** rejected; a breaking change is a new
  version, never an edit.

## Consequences

- `openapi.json` is large (about 300 KB), because zod inlines its date-time, email and UUID
  patterns at every use. A later change could hoist shared schemas into `components`.
- The diff compares unions by position. Reordering union options is reported as breaking, which
  is conservative.
- The first PR that adds `schemas.json` has no baseline on `main`; the diff reports that and
  passes. Every later PR is compared.
- This ADR is numbered 0007; ARCHITECTURE.md 16.1 keeps its own ADR list (ADR-1 to ADR-8).
