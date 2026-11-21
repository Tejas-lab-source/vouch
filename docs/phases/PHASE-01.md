## Phase 1 — Repository foundation and tooling: Completion Report

**Summary:** Vouch is now a Turborepo + pnpm 10 monorepo on Node 24. Lint, format,
boundary checks, tests (including a Testcontainers smoke test against real Postgres 17
and Redis 7) and the Docker build all run locally and in GitHub Actions. `apps/api`
boots, answers `GET /health` with `{"status":"ok"}` and shuts down gracefully on
SIGTERM. Local Postgres and Redis run through Docker Compose.

**Completion criteria:**

- [x] `pnpm install && pnpm lint && pnpm test && pnpm check:boundaries` pass from a clean
      clone — evidence: fresh `git clone` of the branch, all four (plus `format:check`
      and `build`) exit 0; outputs below.
- [x] `docker compose up` starts Postgres and Redis; the API connects to neither yet but
      boots — evidence: `docker compose up -d --wait` → both `healthy`; the API started
      with `node --env-file=.env apps/api/src/main.js` answered `/health` and shut down
      cleanly. The CI `docker` job repeats the Compose health check.
- [x] CI is green on the phase branch — evidence: CI run linked below.
- [x] `docs/PROGRESS.md`, ADR 0001 and `README.md` exist (plus ADR 0002, which you
      asked for).

**What was built:**

- **Monorepo root:**
  - `package.json` (`"type": "module"`, `engines.node: ">=24 <25"`,
    `packageManager: pnpm@10.34.9`)
  - `pnpm-workspace.yaml`, `turbo.json` (`lint`, `test`, `build`, `dev`, plus the root
    `//#lint:root` task)
  - `.nvmrc`, `.editorconfig`, `.gitignore`, `.prettierignore`, `eslint.config.js`,
    `prettier.config.js`
- **`packages/config`:**
  - `eslint.config.js`: ESLint 9 flat config with `@eslint/js` recommended,
    `eslint-plugin-n` (`flat/recommended-module`, plus `flat/recommended-script` for
    `.cjs`), `eslint-plugin-security`, `no-console`, and a local rule
    `vouch/require-ts-check` that fails any `.js`/`.cjs` file whose first line is not
    `// @ts-check`
  - `prettier.config.js`, `vitest.preset.js`
  - `test/containers.js`: `startTestContainers()` starts Postgres 17 and Redis 7 and
    returns `{ postgresUrl, redisUrl, stop }`
- **Boundaries:** `.dependency-cruiser.cjs` holds 11 rule groups (17 rules once the
  frontend layer rules are expanded):
  - `domain-pure`
  - `application-allowed-imports`
  - `api-only-own-application`
  - `no-module-internals`
  - `platform-no-modules`
  - `contracts-zod-only`
  - FSD layer rules and FSD cross-slice rules
  - `no-cross-app-imports`, `packages-no-apps`
  - `no-circular`, `not-to-unresolvable`, `src-not-to-dev-dependency`
- **`apps/api`:**
  - `src/app.js` (`buildApp()`, `GET /health` with a response schema)
  - `src/main.js` (reads `PORT`/`HOST`/`LOG_LEVEL`, refuses to boot on an invalid
    `PORT`, graceful shutdown on SIGTERM/SIGINT with a 10 s forced-exit fallback)
  - tests
- **Containers:**
  - `docker-compose.yml`: `postgres:17-alpine` on tmpfs and
    `redis:7-alpine --save "" --appendonly no`, both with health checks and ports bound
    to 127.0.0.1
  - `.env.example`
  - `Dockerfile`: multi-stage; `pnpm deploy --prod` bundle; runtime runs as `node`
    (uid 1000), with `HEALTHCHECK`
  - `.dockerignore`
- **CI:** `.github/workflows/ci.yml` has two parallel jobs, each with a 10-minute
  timeout:
  - `verify`: frozen install → lint → format check → boundaries → tests
    (Testcontainers)
  - `docker`: `docker compose up -d --wait` (healthy) → `docker build` → `docker run` →
    `curl /health` must equal `{"status":"ok"}` → `docker stop` must exit 0
- **Docs:**
  - `docs/PROGRESS.md`
  - `docs/adr/0001-record-architecture-decisions.md`
  - `docs/adr/0002-session-branch-and-phase-pull-requests.md`
  - `docs/phases/PHASE-01.md`
  - `CHANGELOG.md`, `README.md`

**Tree of created files:**

```
.dependency-cruiser.cjs
.dockerignore
.editorconfig
.env.example
.github/workflows/ci.yml
.gitignore
.nvmrc
.prettierignore
CHANGELOG.md
Dockerfile
README.md
apps/api/eslint.config.js
apps/api/package.json
apps/api/src/app.js
apps/api/src/main.js
apps/api/test/health.test.js
apps/api/test/main.test.js
apps/api/vitest.config.js
docker-compose.yml
docs/PROGRESS.md
docs/adr/0001-record-architecture-decisions.md
docs/adr/0002-session-branch-and-phase-pull-requests.md
docs/phases/PHASE-01.md
eslint.config.js
package.json
packages/config/eslint-rules/require-ts-check.js
packages/config/eslint.config.js
packages/config/package.json
packages/config/prettier.config.js
packages/config/test/containers.js
packages/config/test/containers.test.js
packages/config/vitest.config.js
packages/config/vitest.preset.js
pnpm-lock.yaml
pnpm-workspace.yaml
prettier.config.js
turbo.json
```

**Tests and validation:**

Versions used: Node v24.22.3, pnpm 10.34.9, Docker 29.10.0. All local commands below
ran in a fresh `git clone` of the branch.

```
$ pnpm install --frozen-lockfile
Done in 927ms using pnpm v10.34.9

$ pnpm lint
 • Running lint, lint:root in 3 packages
 Tasks:    3 successful, 3 total            (eslint --max-warnings 0 in each)

$ pnpm format:check
All matched files use Prettier code style!

$ pnpm check:boundaries
✔ no dependency violations found (25 modules, 23 dependencies cruised)

$ pnpm test -- --reporter=verbose
 ✓ test/health.test.js > GET /health > returns 200 with { status: "ok" }
 ✓ test/health.test.js > GET /health > returns 404 for unknown routes
 ✓ test/main.test.js > main.js process lifecycle > listens on PORT and serves /health
 ✓ test/main.test.js > main.js process lifecycle > shuts down gracefully on SIGTERM with exit code 0
 ✓ test/main.test.js > main.js process lifecycle > refuses to boot with an invalid PORT
 ✓ test/containers.test.js > Testcontainers smoke test > connects to Postgres 17
 ✓ test/containers.test.js > Testcontainers smoke test > connects to Redis 7
 @vouch/api     Tests  5 passed (5)
 @vouch/config  Tests  2 passed (2)

$ pnpm build
 Tasks: 0 total (no-op by design: no compile step; the image is the artifact)
```

Deliberate boundary violation. I added a temporary file
`apps/api/src/modules/matching/domain/boundary-violation.js` that imports `fastify`
(I/O in domain code):

```
$ pnpm check:boundaries
  error domain-pure: apps/api/src/modules/matching/domain/boundary-violation.js → node_modules/.pnpm/fastify@5.12.8/node_modules/fastify/fastify.js

x 1 dependency violations (1 errors, 0 warnings). 26 modules, 24 dependencies cruised.
 ELIFECYCLE  Command failed with exit code 1.
```

The file was then removed, and the check was clean again (`✔ no dependency violations
found`).

During development I also ran a wider throwaway test that broke every backend, FSD and
workspace rule once. The following rules each reported their violation: `domain-pure`,
`application-allowed-imports`, `api-only-own-application`, `no-module-internals`,
`platform-no-modules`, `contracts-zod-only`, `fsd-shared-no-higher-layer`,
`fsd-entities-no-higher-layer`, `fsd-features-no-cross-slice`, `no-cross-app-imports`
and `not-to-unresolvable` (15 errors in total). The allowed imports passed: domain →
`packages/domain`, and adapters → another module's `api.js`.

Docker:

```
$ docker compose up -d --wait
 Container vouch-redis-1 Healthy
 Container vouch-postgres-1 Healthy

$ docker build -t vouch-api:local .        # ~23 s; image 261 MB (node:24-alpine base)
$ docker run --rm --entrypoint sh vouch-api:local -c 'id; ls /app/node_modules'
uid=1000(node) gid=1000(node)
fastify                                     # only production deps; no vitest/eslint/testcontainers
$ docker run -d --name api -p 3000:3000 vouch-api:local
$ curl -fsS http://127.0.0.1:3000/health
{"status":"ok"}
$ docker inspect -f '{{.State.Health.Status}}' api   → healthy
$ docker stop api                                     → exit code 0
{"signal":"SIGTERM","msg":"shutting down"}
{"msg":"shutdown complete"}
```

CI: see the CI run link at the end of this report.

Coverage: not measured in Phase 1; the roadmap asks for no coverage numbers here.

**Decisions made:**

- [ADR 0001 — Record architecture decisions](../adr/0001-record-architecture-decisions.md)
- [ADR 0002 — Session branch and one pull request per phase](../adr/0002-session-branch-and-phase-pull-requests.md)

**Deviations from the roadmap:**

- **Branch:** work was done on the session branch `claude/lucid-rubin-foq2uj` instead of
  `phase/01-foundation`, as you decided and as ADR 0002 records.
- **Extra file `apps/api/src/app.js`** (`buildApp()`), which you approved.
- **`.dependency-cruiser.cjs` is CommonJS,** because the roadmap names that file. It
  carries `// @ts-check`, and JSON and YAML files are exempt, as you approved.
- **`turbo build` is a no-op,** and the Docker image is the build artifact, as you
  approved.
- **`envMode: "loose"` in `turbo.json`.** Turbo 2's default strict mode strips
  environment variables that Testcontainers and Docker need (for example `DOCKER_HOST`).
- **`ignoredBuiltDependencies`** in `pnpm-workspace.yaml.` This keeps pnpm 10's
  install-script block for three optional native helpers of testcontainers' transitive
  dependencies (`cpu-features`, `protobufjs`, `ssh2`). It is explicit rather than a
  warning, and no install scripts run.
- **Extra `apps/api/test/main.test.js`.** It spawns the real process to prove the
  SIGTERM graceful shutdown and the invalid-`PORT` refusal.
- **Local-only build setup.** This cloud container reaches the internet only through an
  HTTPS proxy, so the local `docker build` used `--network host`, proxy build arguments
  and a local base image that adds the proxy CA, passed through the Dockerfile's
  `NODE_IMAGE` build argument. Nothing proxy-related is committed, and CI builds the
  plain Dockerfile with `node:24-alpine`.

**Known issues and risks:**

- **ESLint 9 end-of-life.** pnpm reports that `eslint@9.39.5` is no longer supported
  upstream (ESLint 10.x is current). The approved stack says ESLint 9, so I kept it.
  Moving to ESLint 10 needs your approval and a roadmap or ADR update.
- **`// @ts-check` is editor-only.** Nothing in CI runs a type check yet, because the
  approved stack has no `typescript` package. See follow-ups.
- **Health checks flood logs.** Every request is logged at `info`, including the Docker
  health check every 10 s. Phase 4 replaces logging setup (pino redaction, request and
  trace ids), which is the right place to quiet `/health`.
- **Action and image tags are not pinned to digests.** CI uses major-version tags
  (`actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`), and the
  images use floating minor tags (`postgres:17-alpine`, `redis:7-alpine`,
  `node:24-alpine`).

**Suggested follow-ups (not done, need approval):**

1. Add a CI type-check step (`tsc --noEmit --allowJs --checkJs`). This needs
   `typescript` as a dev dependency, which is not in the approved stack.
2. Pin GitHub Actions and base images by digest, with Dependabot or Renovate to keep
   them current.
3. Decide on ESLint 9 versus 10 before the lint surface grows.
4. Add a regression test for the boundary rules: fixture files that must fail each rule,
   so rule edits can't silently weaken them.

**How you can check it yourself:**

```bash
git fetch origin claude/lucid-rubin-foq2uj && git checkout claude/lucid-rubin-foq2uj
```

```bash
corepack enable && pnpm install --frozen-lockfile
```

```bash
pnpm lint && pnpm format:check && pnpm check:boundaries && pnpm test
```

```bash
cp .env.example .env && docker compose up -d --wait && docker compose ps
```

```bash
docker build -t vouch-api . && docker run --rm -p 3000:3000 vouch-api
```

Then, in another terminal:

```bash
curl http://localhost:3000/health
```

**CI run:** https://github.com/Tejas-lab-source/vouch/actions/runs/44862602474

**Pull request:** opened from `claude/lucid-rubin-foq2uj` into `main`, titled "Phase 1 —
Repository foundation and tooling" · Branch: `claude/lucid-rubin-foq2uj` (see ADR 0002)

⏸️ I have stopped. Reply "Approved: Phase 1 complete" to close this phase.
I will not start Phase 2 until you approve its start plan.
