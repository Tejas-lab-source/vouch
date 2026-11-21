# Vouch

Dating app and website for verified college students.

The build follows [`docs/ROADMAP.md`](docs/ROADMAP.md) phase by phase. Current status is
in [`docs/PROGRESS.md`](docs/PROGRESS.md), and decisions are in [`docs/adr/`](docs/adr/).

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 10, through Corepack (the exact version is pinned in `package.json` → `packageManager`)
- Docker with Docker Compose v2, for local services and integration tests

## Setup

1. Use Node 24 and enable Corepack, which provides the pinned pnpm:

   ```bash
   nvm use
   corepack enable
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create your local environment file. It holds placeholder values only and is git-ignored:

   ```bash
   cp .env.example .env
   ```

4. Start Postgres 17 and Redis 7. Persistence is off, so data is lost on `docker compose down`:

   ```bash
   docker compose up -d --wait
   ```

5. Create the database schemas, roles and synthetic seed data (2,000 users). Both commands are
   safe to re-run:

   ```bash
   pnpm db:migrate && pnpm db:seed
   ```

6. Run the API in watch mode:

   ```bash
   pnpm --filter @vouch/api dev
   ```

   Then check <http://localhost:3000/health> (`{"status":"ok"}`) and
   <http://localhost:3000/ready> (Postgres, Redis and migrations). Metrics are on
   <http://localhost:9464/metrics>, and the API explorer is at <http://localhost:3000/docs>.
   `ROLE` in `.env` picks `api`, `ws`, `worker` or `all` (default).

## Common commands

| Command                   | What it does                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `pnpm lint`               | ESLint for every package and the root files; warnings fail        |
| `pnpm format:check`       | Prettier check (`pnpm format` rewrites files)                     |
| `pnpm check:boundaries`   | dependency-cruiser layer and module boundary rules                |
| `pnpm test`               | Vitest in every package, including Testcontainers (needs Docker)  |
| `pnpm typecheck`          | `tsc --checkJs --noEmit` over every `.js`/`.cjs` file             |
| `pnpm db:migrate`         | Apply all migrations (`pnpm db:migrate:down --all` reverts them)  |
| `pnpm db:seed`            | Load deterministic synthetic data (refuses in production)         |
| `pnpm contracts:generate` | Regenerate `packages/contracts/openapi.json` and `schemas.json`   |
| `pnpm contracts:diff`     | Fail on breaking contract changes against `origin/main`           |
| `pnpm new-module <name>`  | Scaffold a backend module (see `apps/api/src/platform/README.md`) |
| `pnpm build`              | No-op: no compile step; the Docker image is the build artifact    |
| `pnpm dev`                | Runs every package's `dev` task                                   |

## Docker image

```bash
docker build -t vouch-api .
```

```bash
docker run --rm -p 3000:3000 vouch-api
```

The image holds production dependencies only and runs as the non-root `node` user.

## Repository layout

```
apps/api/          Backend: platform kernel (src/platform), modules (src/modules), migrations, seed.
packages/config/   Shared ESLint, Prettier and Vitest config, plus the Testcontainers helper.
packages/contracts/ zod contracts for every boundary, plus generated OpenAPI (see its README).
docs/              Roadmap, architecture, data model, progress, ADRs and phase reports.
```

The full target layout is in `docs/ROADMAP.md` Part B.5.
