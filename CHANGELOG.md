# Changelog

All notable changes are recorded here, grouped by roadmap phase.

## Phase 1 — Repository foundation and tooling

### Added

- Turborepo + pnpm 10 monorepo (`pnpm-workspace.yaml`, `turbo.json`) with `lint`,
  `test`, `build` (no-op; the Docker image is the build artifact) and `dev` pipelines.
- Node 24 requirement (`engines`, `.nvmrc`); ESM everywhere.
- `packages/config`:
  - shared ESLint 9 flat config with `eslint-plugin-n`, `eslint-plugin-security` and a
    local `vouch/require-ts-check` rule
  - Prettier config and Vitest preset
  - Testcontainers helper that starts Postgres 17 and Redis 7
- `.dependency-cruiser.cjs` encoding the layer and boundary rules of roadmap Part B.4,
  run by `pnpm check:boundaries`.
- `apps/api` skeleton: `buildApp()` in `src/app.js`, `GET /health` →
  `{ "status": "ok" }`, and graceful shutdown on SIGTERM/SIGINT in `src/main.js`.
- `docker-compose.yml` with Postgres 17 and Redis 7 (persistence off, health checks),
  and `.env.example`.
- Multi-stage `Dockerfile`: production dependencies only, non-root `node` user, and a
  container health check.
- GitHub Actions `ci.yml`: install, lint, format check, boundary check, tests
  (Testcontainers), Compose health, image build and a `/health` check against the
  running container.
- Docs: `docs/PROGRESS.md`, ADR 0001 (record architecture decisions), ADR 0002
  (session branch and phase pull requests), and `README.md`.

## Phase 2 — Database architecture and migrations

### Added

- `pnpm typecheck`: TypeScript 5.9 (dev-only) runs `tsc --checkJs --noEmit` over every
  `.js`/`.cjs` file using the root `tsconfig.json` (strict). It is a step in CI.
- Boundary rule fixture tests (`packages/config/test/boundaries/`): a fixture tree that
  breaks every dependency-cruiser rule once, plus allowed imports that must stay clean.
  The test fails if any rule stops firing or starts firing on an allowed import.
- Database v1 (`docs/data-model.md`): one schema per module (`platform`, `identity`, `profiles`,
  `media`, `safety`, `matching`, `chat`, `notifications`, `admin`), 27 tables, 6 published
  read-only views, and 11 `NOLOGIN` roles (one per module, `vouch_discovery` and the
  `vouch_views` group).
- `matching.swipes` and `chat.messages` are hash-partitioned (16 partitions each) from the first
  migration.
- Migration runner `apps/api/migrations/run.js` (node-pg-migrate, plain SQL, up and down) and
  `pnpm db:migrate`, `pnpm db:migrate:down`.
- Deterministic, idempotent seed `apps/api/scripts/seed.js` (`pnpm db:seed`): 2 colleges, 1
  cluster, 2,000 users with profiles and photos.
- Testcontainers tests for migrations (up, down, up), constraints, partition pruning, the role
  privilege matrix and the seed.
- ADRs 0003 (schema and role per module), 0004 (UUIDv7 keys with a public id), 0005 (hash
  partitioning from the start) and 0006 (no cross-schema foreign keys).

### Changed

- The Docker image now includes `apps/api/migrations/`, so a deploy can run migrations from it.
- `.prettierignore` excludes `docs/ARCHITECTURE.md` (owner-maintained, like the roadmap).

## Phase 3 — API, event and socket contracts

### Added

- `packages/contracts` (zod 4 only) holds every v1 boundary:
  - 35 REST endpoints, including 14 admin endpoints
  - 4 client → server and 4 server → client socket events
  - 13 domain events, with their envelope
  - 7 job payloads and 5 pipeline step shapes
  - the profile-section registry format, `GET /v1/config` and feature-flag rules
  - the environment variable schema
- The error envelope, `AppErrorCode` with fixed HTTP statuses, gender and `interestedIn` codes,
  and cursor pagination.
- Generated `packages/contracts/openapi.json` (OpenAPI 3.1, validated with swagger-parser) and
  `schemas.json` (a JSON Schema snapshot), via `pnpm contracts:generate`.
- `scripts/contracts-diff.js` (`pnpm contracts:diff`) fails on breaking contract changes against
  `main`. CI runs it, plus `pnpm contracts:check`, which fails when the generated files are stale.
- Fixture tests for every schema (valid and invalid examples), a strictness test for every
  emitted object, OpenAPI validation, and contract-diff tests.
- ADR 0007 (contract versioning, ids exposed to clients, contract tooling) and
  `packages/contracts/README.md`.

### Changed

- `docs/data-model.md`: "interests" in v1 means `interested_in`; messages are identified by
  `(conversation_id, seq)`; gender codes; the four proposed retention values are accepted for now.
- The `contracts-zod-only` boundary rule now exempts the package's own tool config files.

## Phase 4 — Backend platform kernel

### Added

- `apps/api/src/platform/**`, the backend kernel (see its README):
  - config, the logger with redaction, and the database layer with `SET LOCAL ROLE` per
    transaction (ADR 0010)
  - Redis clients, the unit of work with outbox `emit`, and advisory pair locks
  - the event bus: relay, inbox consumers, dead-letter queues and nightly retention (ADR 0008)
  - the BullMQ job runner, the module registry and pipelines
  - the use-case pipeline (ADR 0009) and the Redis idempotency store
  - the error envelope, EdDSA token verification, feature flags, the HTTP root, `/health` and
    `/ready`, Prometheus metrics, and OpenTelemetry and Sentry hooks
  - role-aware boot with a graceful drain
- `ROLE=api|ws|worker|all`. `/metrics` is served only on `METRICS_PORT` (default 9464).
- The graceful drain is 25 s by default and configurable with `SHUTDOWN_DRAIN_MS` (max 29 s).
- `/health` and `/ready` produce no request logs; readiness logs only when it changes.
- Migration `20261121009000_discovery_event_grants.sql`:
  - `vouch_discovery` gets the same outbox, inbox, flags and deletion-task grants as other
    module roles
  - module roles get a column-level `SELECT (id)` on `platform.outbox` (for `RETURNING id`)
  - `vouch_platform` can read `public.pgmigrations`
- The test-only `_example` module proves HTTP → use case → outbox → relay → consumer → inbox,
  with the trace id carried through.
- `pnpm new-module <name>` (`scripts/new-module.js`) scaffolds a module.
- Contracts env: `METRICS_PORT` and `SHUTDOWN_DRAIN_MS` (additive).
- Tests: unit tests per kernel component, and Testcontainers integration tests for the database
  kernel, event bus, Redis features, boot of every role and the example module end to end.
  Coverage of `src/platform` is enforced at 90% lines.

### Changed

- The UUIDv7 helper moved from `scripts/lib/uuidv7.js` to `src/platform/ids.js`, as the
  injected `newId`; the seed reuses it and its output is unchanged.
- `src/app.js` was replaced by the kernel HTTP root. The Phase 1 process tests moved into
  `test/platform/boot.test.js` (serve, SIGTERM exit 0, invalid `PORT`).
- The Docker image includes the contracts sources. The CI Docker job runs migrations from the
  image, checks `/health`, `/ready` and `/metrics`, and stops with a 30 s limit.
- `.env.example` lists every required variable, with placeholder secrets and a public-only
  development JWT key.
