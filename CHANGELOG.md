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
