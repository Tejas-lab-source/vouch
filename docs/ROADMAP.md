# Vouch — Development Roadmap for Claude Code

> **Status:** Active · **Version:** 1.0 · **Date:** 2026-11-21
> **Audience:** Claude Code (primary), project owner (reviewer)
> **This file is the single source of truth for what to build and in what order.**

Vouch is a dating app and website only for verified college students. It launches on 1–2 campuses (2k–20k users) and is designed to grow to 1M registered users and 300k daily active users without a rewrite.

This roadmap divides the entire build into **exactly 15 phases**, ordered layer by layer:

| Layer | Phases |
| --- | --- |
| Foundation | 1. Repository foundation and tooling |
| Data | 2. Database architecture and migrations |
| Contracts | 3. API, event and socket contracts |
| Backend core | 4. Backend platform kernel |
| Backend features | 5. Identity and authentication · 6. Profiles, media and photo pipeline · 7. Safety core and discovery engine · 8. Matching · 9. Realtime chat · 10. Notifications, moderation and admin backend |
| Frontend | 11. Frontend foundation · 12. Frontend features I (onboarding, profile, discovery, matching) · 13. Frontend features II (chat, notifications, safety, settings, admin app) |
| Quality and release | 14. End-to-end testing, security, privacy and performance · 15. Deployment, observability and closed beta launch |

---

## Part A — Operating rules for Claude Code (STRICT)

Read Part A completely at the start of every session. These rules override any other instruction in this repository except a direct, explicit instruction from the project owner in the current conversation.

### A.1 The approval protocol

The project owner approves every phase **twice**: once before it starts and once after it ends.

1. **Never start a phase without approval.** Before writing any code for phase N, send a **Phase Start Plan** (template in Part D.1) and stop. Wait until the owner replies with an explicit approval, such as `Approved: start Phase N`.
2. **Work on one phase only.** Do only the tasks listed for the approved phase.
3. **Verify before reporting.** Run every check listed in the phase's *Testing and validation* and *Completion criteria* sections. A phase is not complete until all of them pass.
4. **Report and stop.** Send a **Phase Completion Report** (template in Part D.2) and stop. Do not begin the next phase, do not prepare its files, and do not "get a head start".
5. **Wait for explicit approval.** Only a message such as `Approved: Phase N complete` closes a phase. After that, you may send the Phase Start Plan for phase N+1. You still need a separate `Approved: start Phase N+1` before coding it.
6. **Silence is not approval.** Neither are "looks good", "ok", "nice" or any message that does not clearly approve. If a reply is ambiguous, ask: "Do you approve starting Phase N?" (or "closing Phase N?").
7. **Requested changes reopen the phase.** If the owner asks for changes after a completion report, the phase stays open. Make the changes, re-verify, and send a new completion report.

### A.2 Phase sequence rules

- Phases run strictly in order: 1 → 2 → … → 15. **Never skip a phase, reorder phases or merge two phases.**
- A phase may begin only when every phase it depends on has been approved as complete.
- If you discover that a task from an earlier phase is missing or broken, stop. Report it, propose a fix, and wait for approval before touching the earlier phase's code.
- If the owner asks for something outside the current phase, say which phase it belongs to, and ask whether to note it for later or to change the roadmap. Do not build it silently.

### A.3 Scope discipline

- Implement **only** what the current phase lists. Features, endpoints, screens, tables and packages that belong to later phases must not be created early, not even as stubs, unless the phase explicitly says "stub".
- Do not add dependencies that are not in the approved stack (Part B.2). If one seems necessary, propose it in the Phase Start Plan with a reason and wait for approval.
- No "while I'm here" refactors outside the phase. List them under *Suggested follow-ups* in the completion report instead.
- Do not change public contracts (`packages/contracts`) or migrations from earlier phases without approval. Changes to approved contracts must be additive (Part B.6).

### A.4 Code quality rules

- **Modular:** respect module boundaries and layer rules (Part B.4). One module never imports another module's internals.
- **Clean:** small functions, clear names, no dead code, no commented-out code, no `console.log` (use the logger).
- **Scalable:** no in-memory user state in server processes; every write idempotent; every network call has a timeout.
- **Maintainable:** every file starts with `// @ts-check`, public functions have JSDoc, and every boundary input is parsed with zod.
- **Tested:** every phase ships with the tests it lists. Do not reduce, skip or delete tests to make a build pass.
- **Secure by default:** no secrets in code or git history, parameterised SQL only, and no PII (emails, tokens, message bodies) in logs.

### A.5 Documentation rules

- **Architecture decisions:** record every significant decision as an ADR in `docs/adr/NNNN-title.md` (template in Part D.3). Examples: a library choice, a schema change, or a deviation from this roadmap.
- **Phase log:** at the end of every phase, write `docs/phases/PHASE-NN.md` containing the completion report.
- **Progress tracker:** keep `docs/PROGRESS.md` updated with each phase's status: `Not started`, `Plan sent`, `In progress`, `Report sent`, `Approved`.
- **Module READMEs:** each backend module has a `README.md` covering its purpose, public API, events emitted and consumed, and tables owned.
- **Changelog:** append to `CHANGELOG.md` under the phase heading.
- **Do not edit this roadmap.** Propose roadmap changes in a report; the owner edits this file.

### A.6 Git workflow

- One branch per phase: `phase/NN-short-name` (for example `phase/02-database`), created from `main` only after the phase is approved to start.
- Small, focused commits using Conventional Commits: `feat(matching): add like use case`.
- Open a pull request into `main` at the end of the phase and link `docs/phases/PHASE-NN.md` in its description.
- **Never merge to `main`, force-push, rewrite history or delete branches** unless the owner explicitly asks. The owner merges the PR when approving the phase.
- Never commit `.env` files, keys or credentials. Commit `.env.example` with placeholder values instead.

### A.7 When you are stuck or unsure

- **Ambiguity:** if a requirement is unclear, ask one precise question before implementing. Do not guess on anything that touches data shape, security or public contracts.
- **Blockers:** if a blocker appears (a missing credential, a failing external service), stop, report it with the options you see, and wait.
- **Never fake completion.** Do not mark tests as skipped, mock away the thing under test, or claim a check passed without running it.
- **Contradictions:** if this roadmap conflicts with an ADR, the ADR wins only if the owner approved it. Otherwise ask.

### A.8 Session start checklist (run every time)

1. Read Part A of this file.
2. Read `docs/PROGRESS.md` to find the current phase and its status.
3. Read the current phase section, and the latest `docs/phases/PHASE-NN.md`.
4. Check that the working tree is clean and you are on the correct branch.
5. Then act according to the status:
   - `Not started`: send the Phase Start Plan.
   - `In progress`: continue the approved phase.
   - `Report sent`: wait for the owner.

---

## Part B — Project context (what Claude Code must know)

### B.1 Product scope for v1

| In v1 | Not in v1 (do not build) |
| --- | --- |
| College-email OTP sign-up, ID-card fallback reviewed by admins | Social sign-in, passwords |
| Profile with ≥2 photos, preferences, 18+ only | Prompts, icebreakers, stories, voice notes |
| Swipe deck from the user's campus cluster | Map, GPS or precise location of any kind |
| Mutual like → match → realtime chat | Video calls, group chats |
| Push notifications for matches and messages | Email marketing |
| Block, report, unmatch; photo moderation; admin console | Premium tier, boosts, payments |
| Hand-tuned ranking | Machine-learned ranking |

The architecture provides **extension points** for every "not in v1" item. Build the extension points (registries, slots, pipelines) in the phases that list them, but never the features themselves.

### B.2 Approved technology stack (do not deviate)

**Backend**
- Node.js 24 LTS, plain JavaScript, ES modules (`"type": "module"`), no build step.
- Fastify 5, with `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie` and `@fastify/rate-limit`.
- zod for every boundary, and JSDoc with `// @ts-check` for editor types.
- PostgreSQL 17 via postgres.js (tagged-template SQL, no ORM), and node-pg-migrate with plain SQL migrations.
- Redis 7 (or Valkey) via ioredis; BullMQ for jobs and events.
- Socket.IO with `@socket.io/redis-adapter`, WebSocket transport only.
- `jose` for JWT, sharp for images, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for Cloudflare R2, and pino for logs.
- Sentry, OpenTelemetry and prom-client for observability.
- Vitest, `fastify.inject`, Testcontainers and k6 for testing.
- ESLint 9 (flat config), Prettier, `eslint-plugin-n`, `eslint-plugin-security` and dependency-cruiser.

**Frontend and platform**
- Turborepo with pnpm workspaces.
- Web and admin: React + Vite (JSX), React Router, TanStack Query and socket.io-client.
- Mobile: React Native with Expo (JavaScript) and Expo Router.
- Playwright for web end-to-end tests.
- Cloudflare (DNS, CDN, WAF, Turnstile, R2), Expo push, and Resend or Brevo for email.
- GitHub Actions and Docker.
- Beta hosting on Render (app and Key Value), Render Postgres or Neon, and Cloudflare (R2 and web).

### B.3 Architecture in one page

- **Modular monolith.** One codebase runs as `ROLE=api` (REST), `ROLE=ws` (Socket.IO gateway), `ROLE=worker` (jobs, outbox relay, event consumers) or `ROLE=all` (beta). It ships as one Docker image.
- **Ten backend modules:** `identity`, `profiles`, `media`, `safety`, `discovery`, `matching`, `chat`, `notifications`, `admin`, plus the `platform` kernel.
- **Data ownership:** each module owns one Postgres schema of the same name, with its own Postgres role. There are no cross-schema foreign keys. Other modules read only published views (`*_v`) or call the module's `api.js`.
- **Hexagonal layers inside every module:** `domain/` (pure rules) → `application/` (use cases) → `ports.js` (JSDoc interfaces) → `adapters/` (HTTP, socket, jobs, events, pg, redis, r2). Dependencies point inward only.
- **Module manifest:** each module exports `manifest.js` (via `defineModule`), declaring its routes, socket handlers, jobs, event subscriptions, pipeline contributions, flags, admin panels and migrations. A registry loads modules from the explicit list in `src/modules/index.js`, sorts them by `dependsOn`, and registers only what the current `ROLE` needs.
- **Use-case pipeline:** every use case is wrapped by `useCase()`, which composes tracing, metrics, authorisation, validation, feature-flag and idempotency decorators.
- **Events:** a use case calls `emit(Schema, payload)`, which writes to `platform.outbox` in the same transaction. A relay (`FOR UPDATE SKIP LOCKED`) fans each event out to one BullMQ queue per subscribing module. Consumers deduplicate through `platform.inbox (consumer, event_id)`. Events are named `noun.verb.vN`.
- **Postgres is the source of truth; Redis is disposable.** If Redis is wiped, decks rebuild and lost jobs replay from the outbox.
- **Frontend:** shared packages (`contracts`, `api-client`, `realtime`, `domain`, `features-core`, `ui-tokens`, `ui-web`, `ui-native`, `i18n`, `config`). Each app follows Feature-Sliced Design (`app → pages → widgets → features → entities → shared`), with a client feature registry and named UI slots.

### B.4 Layer and boundary rules (enforced by dependency-cruiser and ESLint)

| Code in | May import | Must never import |
| --- | --- | --- |
| `modules/X/domain/` | Its own domain files, `packages/domain` | Anything with I/O; any other module |
| `modules/X/application/` | Its own domain and ports, `packages/contracts`, `platform/uow` | Adapters, Fastify, postgres.js, ioredis |
| `modules/X/adapters/` | Its own application, contracts, platform, libraries | Another module's internals |
| `modules/X/api.js` | Its own application | Adapters |
| `src/platform/` | Libraries, contracts | Any module |
| `packages/contracts` | zod | Anything else |
| Frontend layer L | Layers strictly below L | Same-layer slices or higher layers |

### B.5 Target repository layout

```
vouch/
  apps/
    api/
      src/
        main.js                 # reads ROLE, boots the registry
        platform/               # kernel (Phase 4)
        modules/
          index.js              # explicit module list
          identity/ profiles/ media/ safety/ discovery/
          matching/ chat/ notifications/ admin/
      migrations/               # node-pg-migrate entry that loads module migrations
      test/                     # cross-module invariant tests, k6 scripts
    web/  mobile/  admin/  landing/
  packages/
    contracts/ api-client/ realtime/ domain/ features-core/
    ui-tokens/ ui-web/ ui-native/ i18n/ config/
  docs/
    ROADMAP.md  PROGRESS.md  ARCHITECTURE.md  adr/  phases/  runbooks/
  docker-compose.yml  Dockerfile  turbo.json  pnpm-workspace.yaml
  .dependency-cruiser.cjs  .env.example  CHANGELOG.md
```

Each backend module has this shape:

```
modules/<name>/
  manifest.js   api.js   ports.js   README.md
  domain/        application/       adapters/{http,socket,jobs,events,pg,redis,pipeline,admin}/
  migrations/
```

### B.6 Conventions

- **Ids:** UUIDv7 primary keys, generated by the injected `newId`. Clients only ever see a random `public_id`.
- **Errors:** `new AppError(code, httpStatus, details?)`, returned in the envelope `{ error: { code, message, details?, requestId } }`.
- **REST:** `/v1`, plural resources, cursor pagination (`{ items, nextCursor }`), an `Idempotency-Key` header on every POST, and `X-App-Version` on every request.
- **Contracts are additive.** Never remove or narrow a field. A breaking change ships as a new version (`v2`) beside the old one.
- **Database changes** follow expand → migrate → contract across separate deploys. Use `CREATE INDEX CONCURRENTLY` on large tables.
- **Time and ids** come from an injected `clock` and `newId`, so tests are deterministic.
- **Naming:**
  - Files use `kebab-case.js` and React components use `PascalCase.jsx`.
  - Redis keys use `<module>:<name>:<id>`.
  - Queues use `evt.<module>` for event consumers, and `fast`, `bulk`, `media` or `external` for job classes.
- **Commits** follow Conventional Commits.

### B.7 Key numbers (design inputs)

| Metric | Beta (20k users) | Design target (1M users) |
| --- | --- | --- |
| API requests/s at peak | ~47 | ~2,344 |
| Swipes/s at peak | ~12.5 | ~625 |
| Messages/s at peak | ~3 | ~156 |
| Concurrent sockets | ~600 | ~30,000 |
| Push/s at peak | ~1.6 | ~80 (Expo limit is 600/s) |

Beta SLOs: API p95 < 300 ms, deck page p95 < 250 ms, message delivery to an online recipient p95 < 1 s, push p95 < 30 s, monthly availability 99.5%.

---

## Part C — The 15 phases

Each phase lists: Objective and outcomes · Depends on · Tasks · Technical requirements · Files and modules · Out of scope · Testing and validation · Completion criteria · Report before approval.

The *Estimated effort* is a planning guide for a solo builder. It is not a deadline; quality and the completion criteria come first.

---

### Phase 1 — Repository foundation and tooling

**Estimated effort:** about 3 days

**Objective and outcomes**
- A working Turborepo + pnpm monorepo where linting, formatting, testing, boundary checks and the Docker build all run locally and in CI.
- Local Postgres and Redis run through Docker Compose.
- An `apps/api` skeleton boots and answers `GET /health`.

**Depends on:** nothing (first phase).

**Tasks**
1. Initialise the monorepo:
   - Configure `pnpm-workspace.yaml` and `turbo.json`, with pipelines for `lint`, `test`, `build` and `dev`.
   - Add a root `package.json` with `"type": "module"` and `engines.node: ">=24 <25"`, plus `.nvmrc`.
2. Create `packages/config` with a shared ESLint 9 flat config (including `eslint-plugin-n` and `eslint-plugin-security`), a Prettier config and a Vitest preset.
3. Add dependency-cruiser with the rules from Part B.4 (`.dependency-cruiser.cjs`), and a `pnpm check:boundaries` script.
4. Create the minimal `apps/api` skeleton:
   - `src/main.js` starts Fastify on `PORT` and exposes `GET /health` → `{ status: "ok" }`.
   - Add graceful shutdown on SIGTERM.
5. Add `docker-compose.yml` with Postgres 17 and Redis 7 (persistence off), plus `.env.example`.
6. Add a multi-stage `Dockerfile` for `apps/api`: production deps only, running as a non-root user.
7. Add a GitHub Actions workflow `ci.yml`. It runs `pnpm install --frozen-lockfile`, lint, format check, boundary check and tests, then builds the Docker image.
8. Create the docs scaffold:
   - `docs/PROGRESS.md`, with all 15 phases listed as `Not started` and Phase 1 as `In progress`.
   - `docs/adr/0001-record-architecture-decisions.md`, `docs/phases/` and `CHANGELOG.md`.
   - A root `README.md` with setup steps.
9. Add `.gitignore`, `.editorconfig` and a Testcontainers helper in `packages/config/test/containers.js`, which starts Postgres and Redis for integration tests.

**Technical requirements**
- Node 24, pnpm 9+, and no TypeScript compile step.
- All packages are ESM; every source file starts with `// @ts-check`.
- The CI run must finish in under 10 minutes.

**Files and modules created:** root config files, `packages/config/**`, `apps/api/src/main.js`, `apps/api/package.json`, `docker-compose.yml`, `Dockerfile`, `.github/workflows/ci.yml`, `.dependency-cruiser.cjs`, `docs/**`, `README.md`, `CHANGELOG.md`, `.env.example`.

**Out of scope:** any database schema, business module, frontend app or deployment.

**Testing and validation**
- A Vitest test for `/health` using `fastify.inject`.
- A Testcontainers smoke test that connects to Postgres and Redis.
- A deliberate boundary violation in a temporary file makes `check:boundaries` fail. Remove the file afterwards, and show the failing output in the report.
- The `docker build` succeeds and the container answers `/health`.

**Completion criteria**
- [ ] `pnpm install && pnpm lint && pnpm test && pnpm check:boundaries` pass from a clean clone.
- [ ] `docker compose up` starts Postgres and Redis; the API connects to neither yet but boots.
- [ ] CI is green on the phase branch.
- [ ] `docs/PROGRESS.md`, ADR 0001 and `README.md` exist.

**Report before approval:**
- The tree of created files.
- Command outputs for lint, test, boundaries and the Docker build.
- The CI run link.
- Node and pnpm versions used.
- Any deviation from this roadmap.

---

### Phase 2 — Database architecture and migrations

**Estimated effort:** about 5 days

**Objective and outcomes**
- The complete v1 database exists as reviewed, versioned SQL migrations.
- It has one schema per module, a role per module, partitioned high-volume tables, published views and seed data.
- Database design is done first because data is the hardest thing to change later.

**Depends on:** Phase 1.

**Tasks**
1. Write `docs/data-model.md`. It lists every entity, its owning module, its invariants and its retention:
   - A pair can match only once.
   - Users must be 18+.
   - Unmatch is permanent.
   - Passes are deleted after 30 days.
   - The rest of the retention rules are listed per table.
2. Configure node-pg-migrate. Each module keeps migrations in `apps/api/src/modules/<m>/migrations/`, and one runner (`apps/api/migrations/run.js`) applies them in timestamp order.
3. Create the schemas: `platform`, `identity`, `profiles`, `media`, `safety`, `matching`, `chat`, `notifications`, `admin`.
4. Create one Postgres role per module that can write only its own schema. Add a read-only `discovery` role that can read only the published views.
5. Create the tables:
   - `platform`: `colleges`, `campus_clusters`, `outbox` (+ partial index on unpublished rows), `inbox (consumer, event_id)` PK, `feature_flags`.
   - `identity`: `users` (`public_id`, `college_id`, `email_hmac` bytea unique, `status`, `birth_date`, `grad_year`, `deleted_at`), `auth_sessions` (hashed refresh token, `family_id`, `device_id`, `expires_at`, `revoked_at`), `devices`, `consents` (notice version, purposes, timestamp).
   - `profiles`: `profiles` (incl. `college_id`, `cluster_id`, preferences, `status`, `last_active_at`), `photos`, `profile_sections` (PK `user_id, type`; `schema_version`, `data jsonb`, `position`).
   - `media`: `uploads`.
   - `safety`: `blocks` (+ index on `blocked_id`), `reports` (+ queue index), `bans`, `verification_reviews`.
   - `matching`: `swipes`, `PARTITION BY HASH (swiper_id)` with 16 partitions and PK `(swiper_id, target_id)`; the partial index `(target_id, created_at) WHERE direction = 1`; and `matches` (`user_low < user_high` check, unique pair).
   - `chat`: `conversations` (`match_id` unique, `last_seq`, `closed_at`); `messages`, `PARTITION BY HASH (conversation_id)` with 16 partitions, PK `(conversation_id, seq)`, unique `(conversation_id, client_msg_id)` and a `kind` column; and `read_cursors`.
   - `notifications`: `prefs`, `deliveries`.
   - `admin`: `audit_log`.
6. Create the published views: `profiles.candidates_v`, `matching.seen_v`, `matching.likes_in_v`, `safety.block_pairs_v`, `identity.active_users_v` and `platform.colleges_v`.
7. Write a seed script (`apps/api/scripts/seed.js`). It creates 2 colleges in 1 cluster and 2,000 synthetic users with profiles and placeholder photo records, and it is deterministic (seeded random).
8. Write ADRs:
   - Schema per module.
   - UUIDv7 keys with a public id.
   - Hash partitioning from the start.
   - No cross-schema foreign keys.

**Technical requirements**
- All primary keys are UUIDv7 (generated by the app), except `outbox.id` (bigserial).
- No cross-schema foreign keys. Same-schema foreign keys only on low-volume tables.
- Every migration is reversible (`down`) or explicitly marked irreversible with a reason.
- Timestamps are `timestamptz`.

**Files and modules created:** `docs/data-model.md`, `apps/api/src/modules/*/migrations/*.sql`, `apps/api/migrations/run.js`, `apps/api/scripts/seed.js`, `docs/adr/0002…0005`.

**Out of scope:** application code that reads or writes these tables (Phases 4–10), and Redis keys.

**Testing and validation**
- A Testcontainers test runs all migrations up, down and up again on an empty database.
- Constraint tests:
  - A duplicate match pair is rejected.
  - `user_low >= user_high` is rejected.
  - A duplicate `client_msg_id` in one conversation is rejected.
- Partition test: rows land in the 16 partitions, and `EXPLAIN` on a `swiper_id` lookup touches one partition.
- Role test: the `matching` role cannot write `chat.messages`, and the `discovery` role can read only views.
- The seed runs twice idempotently and produces exactly 2,000 users.

**Completion criteria**
- [ ] All migrations apply cleanly on Postgres 17 from zero.
- [ ] Every table in Task 5 and every view in Task 6 exists, with the listed constraints and indexes.
- [ ] Role permissions are verified by tests.
- [ ] `docs/data-model.md` and the ADRs are written.

**Report before approval:**
- An ER summary per schema (tables, keys, indexes).
- Migration output, test output and the `EXPLAIN` excerpt for partition pruning.
- Seed timings.
- Any schema decision that differs from this roadmap, with the reason.

---

### Phase 3 — API, event and socket contracts

**Estimated effort:** about 4 days

**Objective and outcomes**
- Every boundary of v1 is defined as zod schemas in `packages/contracts`, and an OpenAPI spec is generated from them.
- Freezing contracts before implementation lets backend and frontend later build against one fixed interface.

**Depends on:** Phase 2, so that contract field names match the data model.

**Tasks**
1. Create `packages/contracts` with this structure:
   - `common/` (ids, cursor pagination, error envelope, `AppErrorCode` enum).
   - `http/<module>.js` (request and response schemas per endpoint).
   - `socket/` (client→server and server→client events, with ack shapes).
   - `events/<module>.js` (domain events, `noun.verb.vN`).
   - `jobs/` (job payloads).
   - `pipelines/` (step input and output shapes).
   - `sections/` (the profile-section registry format).
   - `config/` (the `/v1/config` response).
   - `env.js` (the environment variable schema).
2. Define the REST endpoints with method, path, auth requirement, request, response and error codes:
   - **Auth:** `POST /v1/auth/otp`, `/verify`, `/refresh`; `DELETE /v1/me`; `GET /v1/me/export`.
   - **Config and profile:** `GET /v1/config`; `GET|PATCH /v1/me/profile`; `PUT /v1/me/profile/sections/{type}`.
   - **Media:** `POST /v1/media/uploads`; `POST /v1/media/uploads/{id}/confirm`.
   - **Discovery and matching:** `GET /v1/deck`; `POST /v1/swipes`; `GET /v1/matches`; `POST /v1/matches/{id}/unmatch`.
   - **Chat:** `GET /v1/conversations`; `GET /v1/conversations/{id}/messages?afterSeq=`.
   - **Safety and notifications:** `POST /v1/blocks`; `POST /v1/reports`; `PUT /v1/me/notification-prefs`; `POST /v1/devices` (push token).
   - **Admin:** `/v1/admin/*` (reports queue, report actions, photo review, verification reviews, bans, audit log, flags).
3. Define the socket events:
   - Client → server: `message.send` (with ack), `message.read`, `message.delivered`, `sync`.
   - Server → client: `message.new`, `match.new`, `conversation.closed`, `config.changed`.
4. Define the v1 domain events, with an envelope `{ id, name, version, occurredAt, traceId, payload }`:
   - Identity and profiles: `user.created.v1`, `user.deleted.v1`, `profile.updated.v1`.
   - Media: `photo.uploaded.v1`, `photo.approved.v1`, `photo.rejected.v1`.
   - Discovery and matching: `deck.served.v1`, `match.created.v1`, `match.unmatched.v1`.
   - Chat: `message.created.v1`.
   - Safety: `user.blocked.v1`, `report.created.v1`, `user.banned.v1`.
5. Add the OpenAPI generation script (`pnpm contracts:openapi` → `packages/contracts/openapi.json`).
6. Add a contract-diff script for CI. It compares against `main` and fails the build on a removed field, a narrowed type or a renamed event.
7. Write `packages/contracts/README.md` explaining the versioning rules.

**Technical requirements**
- Schemas are pure zod with no runtime dependencies besides zod.
- Response schemas list every field explicitly; nothing passes through.
- Every POST schema documents its idempotency key.

**Files and modules created:** `packages/contracts/**`, `scripts/contracts-diff.js`, a CI step in `ci.yml`, `docs/adr/0006-contract-versioning.md`.

**Out of scope:** route handlers, socket server, generated client (Phase 11), any business logic.

**Testing and validation**
- Unit tests that every schema parses a valid example and rejects one invalid example (fixtures in `packages/contracts/test/fixtures`).
- The OpenAPI spec validates with an OpenAPI validator.
- The contract-diff script is tested with one additive change (passes) and one breaking change (fails).

**Completion criteria**
- [ ] Every endpoint, socket event, domain event and job in Tasks 2–4 has a schema and a fixture.
- [ ] `openapi.json` is generated and committed.
- [ ] The contract-diff check is in CI.

**Report before approval:**
- A table of all endpoints, socket events and domain events.
- A link to `openapi.json`.
- Test output.
- Any open questions about payload shapes.

---

### Phase 4 — Backend platform kernel

**Estimated effort:** about 8 days

**Objective and outcomes**
- The shared backend core that every module depends on is built and tested before any feature.
- It provides config, logging, database and Redis access, the unit of work, the outbox/relay/inbox event bus, the job runner, the module registry, the use-case pipeline, feature flags, auth verification, the error model, rate limiting and health checks.
- The process boots in each `ROLE`.

**Depends on:** Phases 1–3.

**Tasks**
1. **Config:** `platform/config.js` parses `process.env` with `contracts/env.js` and refuses to boot on an error. It loads `.env` locally through `node --env-file`.
2. **Logger:** pino with request id, trace id and module fields, and redaction of authorization headers, tokens, emails and message bodies.
3. **Database:**
   - `platform/db.js` creates a postgres.js client per module role.
   - Settings: `max: 10`, `idle_timeout: 20`, `transform: postgres.camel`, and `prepare` configurable (false behind a hosted transaction pooler).
4. **Redis:** `platform/redis.js` holds a command client, a publisher/subscriber pair for Socket.IO, and a BullMQ connection with `maxRetriesPerRequest: null`.
5. **Unit of work:** `platform/uow.js` provides `uow.run(fn)`, which opens a transaction and passes `{ tx, stores, emit }`. `emit(Schema, payload)` validates and inserts into `platform.outbox` in the same transaction, with the current trace id.
6. **Advisory lock helper:** `lockPair(tx, a, b)` uses `pg_advisory_xact_lock(hashtextextended(low||high, 0))`.
7. **Event bus:**
   - `platform/events/relay.js` reads `FOR UPDATE SKIP LOCKED` in batches of 200. It fans out to `evt.<consumer>` queues with `jobId = <consumer>:<outboxId>`, polls every 200 ms while busy and backs off to 2 s when idle.
   - `platform/events/consume.js` implements inbox deduplication (`INSERT ... ON CONFLICT DO NOTHING`) and the handler run in one transaction.
   - A nightly job deletes published outbox rows older than 7 days.
8. **Job runner:** `platform/jobs.js` defines named queue classes (`fast`, `bulk`, `media`, `external`) with retries, exponential backoff with jitter, dead-letter handling, and repeatable (cron) jobs run once across workers.
9. **Module registry:**
   - `platform/registry.js` provides `defineModule()` with a zod-validated manifest. The manifest keys are `name`, `version`, `dependsOn`, `api`, `http`, `socket`, `jobs`, `subscribe`, `contribute`, `sections`, `messageKinds`, `templates`, `exports`, `flags`, `admin` and `migrations`.
   - The registry topologically sorts modules and fails on cycles. It injects dependency APIs and registers only what the current `ROLE` needs.
10. **Pipelines:** `platform/pipelines.js` holds named ordered chains, where each step has an order and a timeout. A failing step is skipped and logged, except in chains marked `failClosed`.
11. **Use-case pipeline:** `platform/use-case.js` provides `useCase(name, handler, opts)` composing `withTracing`, `withMetrics`, `withAuthz`, `withValidation`, `withFlag` and `withIdempotency`, with idempotency stored in Redis `platform:idem:*` for 24 h.
12. **Errors:** `AppError`, a Fastify error handler that maps it to the envelope, and a default 500 that never leaks stack traces.
13. **Auth verification:** `platform/auth.js` verifies access JWTs with `jose` (EdDSA, `kid` rotation) and decorates `request.user`. Token issuance belongs to Phase 5.
14. **Feature flags:** `platform/flags.js` evaluates rules (campus, cohort, percentage by user-id hash, platform, minimum app version, kill switch) and caches them in Redis for 30 s.
15. **HTTP root:** helmet, CORS allowlist, cookies and the Redis-backed rate limiter, plus the zod type provider and swagger at `/docs` (non-production only).
16. **Health:** `/health` (liveness) and `/ready` (Postgres, Redis and migrations up to date).
17. **Boot:**
    - `main.js` reads `ROLE` (`api|ws|worker|all`) and starts the matching servers and workers.
    - It shuts down gracefully: stop accepting, drain for 30 s, close pools.
18. **Observability base:** OpenTelemetry auto-instrumentation, prom-client `/metrics` (process, event-loop lag, HTTP RED), and Sentry init (DSN optional).
19. **Example module:** `modules/_example`, used only by tests, proves that the registry, pipeline, outbox and consumer work end to end. Excluded from the production module list.
20. **Generator:** `scripts/new-module.js` scaffolds a module folder with manifest, api, ports, README and test stubs.

**Technical requirements**
- `src/platform` imports no module.
- Every exported function has JSDoc.
- 90%+ line coverage on `src/platform`.

**Files and modules created:** `apps/api/src/platform/**`, `apps/api/src/main.js` (modified), `apps/api/src/modules/index.js` (empty production list), `apps/api/src/modules/_example/**` (test only), `scripts/new-module.js`, ADRs for the event bus and the use-case pipeline.

**Out of scope:** any real business module, token issuance, socket business handlers.

**Testing and validation**
- **Unit tests:** config parsing, flag evaluation (each rule type), pipeline ordering and timeout, `AppError` mapping, and registry sorting and cycle detection.
- **Integration (Testcontainers):**
  - An emitted event is written atomically, so a rolled-back transaction leaves no outbox row.
  - The relay fans out to two consumers.
  - A redelivered event runs its handler once.
  - A failing consumer dead-letters without blocking the other consumer.
  - Two concurrent relays never double-publish.
- **Idempotency:** the same key twice returns the stored result and runs the handler once.
- **Boot:** the process boots in each of the four roles, and `/ready` reflects a stopped Redis.

**Completion criteria**
- [ ] All kernel components in Tasks 1–20 exist, are documented and are tested.
- [ ] The `_example` module flows end to end: HTTP → use case → outbox → relay → consumer → inbox.
- [ ] Coverage on `src/platform` is at least 90%.
- [ ] The boundary check passes.

**Report before approval:**
- A component list with file paths.
- Test and coverage output.
- A sequence log from the end-to-end example, showing trace ids carried through.
- Boot logs for each role.
- Measured relay latency (event written → consumer ran) locally.

---

### Phase 5 — Identity and authentication module

**Estimated effort:** about 6 days

**Objective and outcomes**
- Users can sign up and sign in with a college-email OTP and receive access and refresh tokens.
- They can manage devices, record consent, and request account deletion and data export.
- This is the first real module, and it sets the pattern every later module copies.

**Depends on:** Phases 2, 3 and 4.

**Tasks**
1. Scaffold `modules/identity` with the generator.
2. **Domain:** email normalisation; college domain matching; age check (refuse under 18 using `birth_date` and the injected clock); OTP rules (6 digits, 10 min, 5 attempts); refresh-token family rules.
3. **Use cases:**
   - `requestOtp`:
     - Rate-limit per email, IP and device.
     - Check Turnstile through a `CaptchaVerifier` port.
     - Generate the code with `crypto.randomInt`, store it hashed in Redis `identity:otp:{emailHmac}`, and send it through the `EmailProvider` port.
   - `verifyOtp`:
     - Create the user if new, with `email_hmac` = HMAC-SHA256 using the server secret.
     - Record the consent with the notice version, and emit `user.created.v1`.
     - Issue a 15-minute EdDSA access JWT and a 30-day refresh token (stored hashed with `family_id` and `device_id`).
   - `refresh`: rotate the token; reuse of a rotated token revokes the whole family.
   - `logout`, `listDevices`, `revokeDevice`.
   - `deleteAccount`: mark deleted, revoke all sessions, emit `user.deleted.v1`.
   - `exportData`:
     - Collect identity data plus each module's export through a registry hook, `exports`, declared in manifests.
     - In this phase only identity is wired; later modules add theirs.
4. **Ports and adapters:** `EmailProvider` (Resend or Brevo adapter + a console adapter for development), `CaptchaVerifier` (Turnstile adapter + always-pass development adapter), `pg` stores for users, sessions, devices and consents, and the Redis OTP store.
5. **HTTP routes:** per Phase 3 contracts: `/v1/auth/*`, `DELETE /v1/me`, `GET /v1/me/export` and `POST /v1/devices`.
6. **Public API (`api.js`):** `getUser`, `assertActive`, `getUsersByIds`.
7. **Key management:** load signing keys from env, and expose a JWKS-like internal list for `platform/auth.js` with `kid` rotation.
8. **Ban hook:** a consumer for `user.banned.v1` that revokes sessions. The handler is wired now, but the event itself is emitted in Phase 10.
9. Write the module README and an ADR for the token strategy.

**Technical requirements**
- No plaintext email is stored anywhere; logs show only `emailHmac` prefixes.
- OTP comparison uses constant-time comparison.
- Every route goes through `useCase()`, with the right `authz` (`public`, `user`).

**Files and modules created:** `apps/api/src/modules/identity/**`, an `identity` line in `modules/index.js`, `docs/adr/00NN-token-strategy.md`.

**Out of scope:** profile creation (Phase 6), the ID-card fallback review queue (Phase 10 builds the review UI; this phase only records `status = 'pending_review'` when requested), and social login.

**Testing and validation**
- **Domain:** unit tests for age, domain matching and OTP rules.
- **Use cases:** tests with fakes, covering a happy path, a wrong code, attempts exhausted, an expired code and an under-18 refusal.
- **Integration:** a full OTP → verify → refresh → rotate cycle; refresh-token reuse revokes the family; deleting an account emits `user.deleted.v1` exactly once.
- **Contract:** every route's response validates against its schema.
- **Security:**
  - Rate limits trigger at their thresholds.
  - The JWT signed with a retired key fails after its grace window.
  - A token with the admin audience is rejected on user routes and vice versa.

**Completion criteria**
- [ ] Sign-up, sign-in, refresh, logout, device revoke, delete and export work through `fastify.inject` and through curl against `ROLE=all`.
- [ ] No PII appears in a captured log sample.
- [ ] Module README is complete.

**Report before approval:**
- The route table with status codes.
- Test output.
- The sample log lines (redacted).
- The token lifetimes and rate-limit values chosen.
- Any decisions recorded as ADRs.

---

### Phase 6 — Profiles, media and photo pipeline

**Estimated effort:** about 7 days

**Objective and outcomes**
- Users create and edit a profile with preferences and sections, and upload photos straight to R2 by presigned URL.
- Photos are processed (EXIF stripped, resized to WebP), moderated, and become visible only when approved.

**Depends on:** Phases 4 and 5.

**Tasks**
1. Scaffold `modules/profiles` and `modules/media`.
2. **Profiles:**
   - **Domain:** profile completeness (≥2 approved photos, name, gender, interests, age range within 18–30 by default); status transitions (`pending → active → hidden`).
   - **Use cases:** `createEmptyProfile` (consumer of `user.created.v1`), `getMyProfile`, `updateProfile`, `putSection(type, data)`.
     - `putSection` validates `data` against the zod schema registered under the manifest key `sections`.
     - In v1 there are no section types yet, so the registry is empty and unknown types return `UNKNOWN_SECTION_TYPE`.
   - Emit `profile.updated.v1` on every change.
   - **Card hydration:** `api.getCards(ids)` returns profile cards, with Redis `profiles:card:{uid}` cached for 10 minutes and invalidated on edit.
   - **Pipeline owner:** register the `profiles.cardFields` chain (empty in v1).
   - **Consumers:** `photo.approved.v1` and `photo.rejected.v1` (update the photo list and profile completeness), and `user.deleted.v1` (erase the profile, sections and photo records).
3. **Media:**
   - `presignUpload`: allowed types `image/jpeg`, `image/png`, `image/webp`; max 10 MB; size and content type fixed in the signature; key `uploads/raw/{uploadId}`. Record the upload as `pending`.
   - `confirmUpload`: emit `photo.uploaded.v1`.
   - Image worker (`media` queue): validate magic bytes; strip EXIF; write WebP at 1080 px and 400 px; run the `safety.contentChecks` pipeline (Phase 7 owns it; in this phase call it through a `ContentCheck` port with a development adapter that always approves); move variants to `photos/{userId}/{photoId}_{size}.webp`; emit `photo.approved.v1` or `photo.rejected.v1`.
   - `StorageProvider` port with an R2 adapter (`@aws-sdk/client-s3`) and a local MinIO or filesystem adapter for development and tests.
   - An R2 lifecycle rule (documented, applied in Phase 15) deletes `uploads/raw/` after 1 day.
4. **Export hooks:** profile and photo data in `exportData`.
5. Write module READMEs.

**Technical requirements**
- Photo bytes never pass through the API process.
- Variants are served from a CDN base URL from config; the database stores only object keys.
- The image worker's concurrency is configurable and defaults to 2.

**Files and modules created:** `apps/api/src/modules/profiles/**`, `apps/api/src/modules/media/**`, updates to `modules/index.js`, a MinIO service in `docker-compose.yml` for local S3.

**Out of scope:** discovery and deck logic, real moderation-provider integration (Phase 7 adds the `ModerationProvider` adapter), and any frontend.

**Testing and validation**
- **Unit:** completeness rules and status transitions.
- **Integration:**
  - The presign → upload (to MinIO) → confirm → worker → approved flow.
  - A JPEG with GPS EXIF comes out with no EXIF.
  - A non-image file renamed `.jpg` is rejected.
  - The variants exist at both sizes.
- **Consumers:** `user.created.v1` creates exactly one empty profile on redelivery; `user.deleted.v1` erases profile data.
- **Cache:** an edit invalidates `profiles:card:{uid}`.

**Completion criteria**
- [ ] A user from Phase 5 can create a profile, upload 2 photos and reach `active` status locally.
- [ ] The EXIF-stripping test passes.
- [ ] Contracts are validated for all routes.

**Report before approval:**
- An end-to-end run log (upload to approval) with timings.
- A sample variant's sizes in KB.
- Test output.
- The configuration values chosen (limits, sizes, concurrency).

---

### Phase 7 — Safety core and discovery engine

**Estimated effort:** about 8 days

**Objective and outcomes**
- The block policy, blocking and content checks exist, because discovery, matching and chat all depend on them.
- Users receive a ranked deck of eligible candidates from their campus cluster.
- Decks are precomputed by workers, served from Redis, and never computed on the request path.

**Depends on:** Phases 4, 5 and 6.

**Tasks**
1. **Safety (part 1)** in `modules/safety`:
   - **Domain:** block rules, where a block is symmetric for visibility.
   - **Use cases:** `block(targetId)` inserts the block, adds both ids to Redis `safety:blocked:{uid}` sets, and emits `user.blocked.v1`, all in one transaction. Also `unblock` (admin only) and `listBlocked`.
   - **Public API:** `blockPolicy.isBlocked(a, b, { tx? })`, which checks the Redis set first and falls back to SQL with `tx`. Also `isBanned(userId)` (reads `bans`; populated in Phase 10).
   - **Content checks:**
     - Own the `safety.contentChecks` pipeline, marked `failClosed`.
     - Add a `ModerationProvider` port with one real adapter for the chosen image moderation API (propose the provider in the Phase Start Plan) and a development adapter.
     - Replace Phase 6's development `ContentCheck` port binding with this pipeline.
   - **Routes:** `POST /v1/blocks`.
2. **Discovery** in `modules/discovery` (no tables of its own):
   - **Candidate source:** a SQL adapter reading `profiles.candidates_v`, `matching.seen_v` and `safety.block_pairs_v` through the read-only role. It returns up to 500 eligible ids in the viewer's cluster, matching mutual gender and age preferences.
   - **Own the `discovery.candidateFilters` and `discovery.scorers` pipelines.** The v1 steps are:
     - Filters: exclude self, exclude already-swiped, exclude blocked, exclude banned or deleted, mutual preferences.
     - Scorers: recency of activity, profile completeness, new-user exposure boost, and a per-candidate daily exposure cap stored in Redis.
     - Each step is a separate file with its own test.
   - **Ranker port** (`Ranker`) with a `HandTunedRanker` adapter that combines scorer outputs with weights from config, then diversifies the first 10 slots.
   - **Deck worker** (`fast` queue, `jobId: deck:{uid}` for dedupe): build the top 50, write `discovery:deck:{uid}` (list, 24 h TTL), and reset `discovery:served:{uid}`.
   - **Read path** (`GET /v1/deck`):
     - Pop 10 ids and add them to `discovery:served:{uid}`.
     - Drop blocked, matched and deleted users at read time.
     - Hydrate through `profiles.api.getCards`.
     - Enqueue a refill when fewer than 20 remain.
     - Emit `deck.served.v1` (impressions), batched.
   - **Consumers:** `user.blocked.v1` and `match.created.v1` (remove the pair from both decks); `profile.updated.v1` and `photo.approved.v1` (mark the user's eligibility changed).
3. **Discovery public API (`api.js`):** `nextCards(viewerId)` and `wasServed(viewerId, targetId)` (checks `discovery:served:{uid}`, used by matching in Phase 8).
4. **Read replica support:** the candidate source uses `DATABASE_REPLICA_URL` if set, and the primary otherwise.

**Technical requirements**
- Deck read p95 < 250 ms locally with the 2,000-user seed.
- No request-path query scans more than one cluster.
- Every pipeline step has a timeout (default 50 ms) and is skipped on timeout, except safety steps, which fail closed.

**Files and modules created:** `apps/api/src/modules/safety/**` (part 1), `apps/api/src/modules/discovery/**`, updates to `modules/media` wiring and `modules/index.js`.

**Out of scope:** reports, bans management and the moderation queue (Phase 10); swipes and matches (Phase 8, though `matching.seen_v` already exists from Phase 2); learned ranking.

**Testing and validation**
- **Unit:** each filter and scorer; ranker weighting; diversification.
- **Integration with the seed:**
  - A user receives a deck of 10 eligible profiles.
  - No blocked user ever appears, including right after a block, with a stale deck.
  - The refill triggers below 20.
  - Concurrent refill requests produce one job.
- **Safety:** a block is visible to `isBlocked` immediately in both directions; a failing moderation adapter rejects (fail closed).
- **Performance:** a script measures the deck p95 over 1,000 requests.

**Completion criteria**
- [ ] `GET /v1/deck` returns valid cards for seeded users, with ordering explained by the scorer reasons logged at debug level.
- [ ] The block invariant test passes.
- [ ] The deck p95 target is met.

**Report before approval:**
- The pipeline steps and weights.
- Deck latency numbers.
- Test output.
- The chosen moderation provider and its cost and limits.
- An example deck with reasons.

---

### Phase 8 — Matching module

**Estimated effort:** about 5 days

**Objective and outcomes**
- Swipes are recorded, and a mutual like creates exactly one match, even when both people like each other at the same instant.
- Unmatch is permanent. Passes are written in batches and expire after 30 days.

**Depends on:** Phases 4, 5 and 7.

**Tasks**
1. Scaffold `modules/matching`.
2. **Domain:** `canonicalPair`, `decideMatch`, unmatch rules.
3. **Use cases:**
   - `swipe({ me, targetId, direction, swipeId })`:
     - Idempotent on `swipeId`.
     - Validates that the target is in `discovery:served:{uid}`, through `discovery.api.wasServed`.
     - A pass is enqueued to the `bulk` queue; a like runs `like`.
   - `like`:
     - One transaction: insert the swipe (`ON CONFLICT DO NOTHING`), `lockPair`, check the reverse like, `safety.blockPolicy.isBlocked` with `tx`.
     - Then `matches.createOrGet`, and emit `match.created.v1` only when newly created.
   - `writePassesBatch`: a worker that inserts up to 500 passes per statement.
   - `unmatch(matchId)`: set `unmatched_at` and emit `match.unmatched.v1`.
   - `listMatches`: cursor-paginated, hydrated with `profiles.api.getCards`.
   - `likesIn` (count only in v1; who liked you is premium later, so do not expose identities).
4. **Consumers:** `user.blocked.v1` (unmatch any existing match between the pair), `user.deleted.v1` (delete swipes and anonymise matches).
5. **Scheduled job:** delete passes older than 30 days, partition by partition, in batches of 5,000.
6. **Public API:** `areMatched(a, b)`, `getMatch(matchId)`.
7. **Routes:** `POST /v1/swipes`, `GET /v1/matches`, `POST /v1/matches/{id}/unmatch`.
8. **Exports hook:** the user's swipes and matches.

**Technical requirements**
- Use `pg_advisory_xact_lock` (transaction-level) only; session locks do not survive transaction pooling.
- The like transaction holds the pair lock for under 20 ms at p95 locally.

**Files and modules created:** `apps/api/src/modules/matching/**`, `apps/api/test/invariants/simultaneous-likes.test.js`, update to `modules/index.js`.

**Out of scope:** creating conversations and sending notifications. Those modules consume `match.created.v1` in Phases 9 and 10.

**Testing and validation**
- **Invariant test:** two users like each other concurrently 1,000 times on fresh pairs. Exactly one match and exactly one `match.created.v1` event per pair, every time.
- **Idempotency:** the same `swipeId` sent twice creates one swipe.
- **A blocked pair never matches.**
- **Passes:** batches are written; retention deletes only rows older than 30 days.
- **Contract tests** for all routes.

**Completion criteria**
- [ ] The simultaneous-likes invariant passes 1,000/1,000 runs.
- [ ] Seeded users can swipe through decks and match end to end with `ROLE=all`.

**Report before approval:**
- The invariant test output and lock-hold timings.
- Example request/response pairs.
- Test output.

---

### Phase 9 — Realtime chat and WebSocket gateway

**Estimated effort:** about 8 days

**Objective and outcomes**
- Matched users chat in real time through the `ws` role.
- Messages are ordered by per-conversation sequence numbers, never lost once acknowledged, never duplicated on retry, and replayed after reconnects.

**Depends on:** Phases 4, 5, 7 and 8.

**Tasks**
1. Scaffold `modules/chat`.
2. **Socket server (platform-level, in the `ws` role):**
   - Socket.IO with `@socket.io/redis-adapter` and the WebSocket transport only.
   - Handshake authentication with the access JWT, and re-auth on refresh.
   - Join the room `user:{id}` on connect.
   - Heartbeat every 25 s.
   - Drain connections over 30 s on SIGTERM.
3. **Domain:** message kinds registry (`text` in v1; the manifest key `messageKinds` lets later modules add kinds); body limits (1–1,000 characters); conversation states.
4. **Use cases:**
   - `openConversation(matchId)`: create the conversation, idempotent on `match_id`. It is called by the `match.created.v1` consumer and on demand.
   - `send({ conversationId, clientMsgId, kind, body })`:
     - Check membership and `blockPolicy`, then run the `chat.messageFilters` pipeline (v1 steps: length, link limiter, block check).
     - One transaction: increment `last_seq` with `RETURNING`, then insert with `ON CONFLICT (conversation_id, client_msg_id) DO NOTHING`. If the recipient is offline (presence), also emit `message.created.v1`.
     - Ack with `{ id, seq, createdAt }`. On a duplicate `clientMsgId`, return the original message.
   - `markRead`, `markDelivered` (advance `read_cursors`).
   - `history(conversationId, afterSeq, limit)` (REST) and `sync(cursors)` (socket), which replays missed messages in order.
   - `closeConversation` (consumer of `match.unmatched.v1` and `user.blocked.v1`); emits `conversation.closed` to both users.
5. **Presence:** `chat:presence:{uid}` with a 60 s TTL, refreshed by heartbeat. Expose only "active recently".
6. **Gateway handlers:** `message.send` (ack), `message.read`, `message.delivered`, `sync`. Server emits: `message.new`, `match.new` (from a `match.created.v1` consumer that emits to both users' rooms), `conversation.closed`.
7. **Routes:** `GET /v1/conversations`, `GET /v1/conversations/{id}/messages`.
8. **Consumers:** `user.deleted.v1` (delete the user's messages and close the conversations).
9. **Exports hook:** the user's own sent messages.

**Technical requirements**
- An ack is sent only after the commit.
- The client-facing seq is gapless per conversation.
- Gateway processes hold no state that cannot be rebuilt from Postgres and Redis.

**Files and modules created:** `apps/api/src/platform/ws.js`, `apps/api/src/modules/chat/**`, invariant tests under `apps/api/test/invariants/`, update to `modules/index.js`.

**Out of scope:** push notifications for offline users (Phase 10 consumes `message.created.v1`); typing indicators; media messages.

**Testing and validation**
- **Socket integration** with two gateway processes and one Redis: a message sent on gateway A reaches the recipient connected to gateway B.
- **Invariant tests:**
  - Kill gateway A mid-stream; the client reconnects, syncs, and has every acked message exactly once, in seq order.
  - Retrying `message.send` with the same `clientMsgId` 5 times stores one message.
  - Messages to a closed or blocked conversation are refused.
- **Load smoke:** 500 concurrent sockets locally exchange 50 messages each with zero loss.

**Completion criteria**
- [ ] Two seeded matched users chat in real time through `ROLE=ws`, and replay works after a disconnect.
- [ ] All three invariant tests pass.

**Report before approval:**
- The invariant test outputs.
- Delivery latency p50/p95 from the load smoke.
- Memory per 500 sockets.
- Test output.

---

### Phase 10 — Notifications, moderation and admin backend

**Estimated effort:** about 7 days

**Objective and outcomes**
- Offline users receive push notifications for matches and messages, with preferences, quiet hours and batching.
- Reports, moderation, bans, ID-card verification reviews, an audit log and feature-flag management are available through the admin API.
- The backend is now feature-complete for v1.

**Depends on:** Phases 4–9.

**Tasks**
1. **Notifications** in `modules/notifications`:
   - A `PushProvider` port with an Expo push adapter: chunks of 100, receipts checked, invalid tokens removed. Add a development adapter that logs.
   - A templates registry (manifest key `templates`). The v1 templates are `match.new`, `message.new` and a `likes.digest` summary.
   - **Consumers:** `match.created.v1` (push to the user who liked first), `message.created.v1` (push if the recipient is still offline), `report.created.v1` (notify admins by email), `user.blocked.v1` (cancel pending pushes between the pair).
   - Apply preferences and quiet hours; batch (at most one message push per conversation per 30 s); log `deliveries`.
   - **Routes:** `PUT /v1/me/notification-prefs`.
2. **Safety (part 2)** in `modules/safety`:
   - **Reports:** `report({ targetId, reason, context })` stores an evidence snapshot (profile card; for chat reports the last 20 messages) and emits `report.created.v1`.
   - An auto-hide threshold (configurable, default 3 distinct reporters in 7 days) sets the profile to `hidden` pending review.
   - **Moderation actions:** warn, hide, unhide, ban. A ban emits `user.banned.v1`, which identity, discovery and chat consume.
   - **Verification reviews:** an ID-card fallback queue (approve or reject) that activates the user.
   - A photo review queue for photos flagged by the moderation provider.
   - Repeat-offence counting from `photo.rejected.v1`.
3. **Admin** in `modules/admin`:
   - Admin authentication: a separate audience claim, MFA with TOTP, and an optional IP allowlist from config.
   - **Admin routes** (`/v1/admin/*`): reports queue (filter, detail, act), photo review, verification reviews, user lookup by public id, bans, feature flags (list and edit rules), audit log (read-only).
   - Every admin action writes to `admin.audit_log` with the actor, action, target and details.
   - **Admin panel definitions** (manifest key `admin`): each module declares panels (list columns, detail fields, actions) that the admin app renders in Phase 13.
4. **Consistency job:** a nightly job checks cross-module invariants (matches without conversations, conversations without matches, deleted users with remaining data). It reports counts as metrics and alerts above 0.
5. **Account deletion completion tracking:** each module's `user.deleted.v1` consumer records completion. The admin can see deletions not finished within 24 h.

**Technical requirements**
- Pushes never include message bodies (privacy).
- Admin reads of chats happen only through a report's evidence snapshot.
- Every admin route requires the admin audience and MFA.

**Files and modules created:** `apps/api/src/modules/notifications/**`, `apps/api/src/modules/safety/**` (part 2), `apps/api/src/modules/admin/**`, `apps/api/src/platform/jobs/consistency.js`, update to `modules/index.js`.

**Out of scope:** the admin frontend (Phase 13), email digests, marketing notifications.

**Testing and validation**
- **Notifications:** a match produces one push to the right user; a message to an offline user produces one push; quiet hours suppress; batching collapses 5 messages into 1 push; an invalid token is removed.
- **Safety:** 3 reports auto-hide a profile; a ban revokes sessions, removes the user from decks and closes conversations within one consumer cycle.
- **Admin:** a user token is rejected on admin routes; every admin action creates one audit entry.
- **Deletion:** a full account deletion leaves no rows for that user in any module (except anonymised matches), verified by the consistency job.
- **Full backend scenario:** sign up → profile → photos approved → deck → match → chat → push → report → ban. It runs green through `fastify.inject` plus sockets.

**Completion criteria**
- [ ] The full backend scenario test passes.
- [ ] Every v1 endpoint in `openapi.json` is implemented and contract-tested.
- [ ] Every module has a complete README.

**Report before approval:**
- A coverage table: endpoints and events, implemented and tested.
- The full scenario log.
- Notification timing p95 locally.
- Test output.
- A list of configuration values (thresholds, batching windows).

---

### Phase 11 — Frontend foundation

**Estimated effort:** about 7 days

**Objective and outcomes**
- The frontend architecture exists before any feature screen: shared packages, the design system, a generated API client, the realtime client, and three app shells (web, mobile, admin).
- Each shell is organised by Feature-Sliced Design, with a feature registry and named UI slots.
- Each shell signs a user in against the real backend.

**Depends on:** Phase 3 (contracts) and Phase 5 (auth). Phase 10 must be approved, so the API is stable.

**Tasks**
1. **`packages/api-client`:**
   - Generate typed (JSDoc) fetch functions from `packages/contracts`.
   - Handle base URL, `X-App-Version`, `Idempotency-Key` generation, error-envelope mapping to `ApiError`, and single-flight refresh-token rotation.
   - Add TanStack Query key factories: `keys.me()`, `keys.deck()`, `keys.matches()`, `keys.conversations()`, `keys.messages(id)`.
2. **`packages/realtime`:**
   - A socket.io-client wrapper: connect with the token, re-auth on refresh, exponential reconnect, and `sync` with stored cursors on reconnect.
   - An outgoing message queue that retries with the same `clientMsgId`.
   - Events are delivered into a TanStack Query cache adapter: `message.new` appends to the messages cache, and `match.new` invalidates matches.
3. **`packages/domain`:** shared pure rules (age from date of birth, validators, formatting), moved or shared with the backend domain where identical.
4. **`packages/features-core`:** the hook skeletons (`useSession`, `useConfig`, `useFlags`), with the feature-specific hooks added in Phases 12–13.
5. **`packages/ui-tokens`, `ui-web`, `ui-native`:**
   - Tokens: colour, spacing, type scale, radii and motion, plus light and dark themes.
   - Base components: Button, Input, OtpInput, Avatar, Card, Sheet/Modal, Toast, EmptyState, Skeleton, ListItem, Badge.
   - The components are accessible: labels, focus states, 44 px touch targets.
6. **`packages/i18n`:** English strings and a `t()` helper. No hard-coded user-facing strings in apps.
7. **`apps/web`** (React + Vite + React Router):
   - FSD folders: `app/`, `pages/`, `widgets/`, `features/`, `entities/`, `shared/`.
   - App providers: QueryClient, session, config/flags, realtime.
   - The feature registry with `defineClientFeature()`, and slot rendering through `<Slot name="...">`, with these slots: `home.tabs`, `profile.sections`, `profile.editor`, `chat.composerActions`, `chat.messageRenderers`, `deck.cardBadges`, `settings.rows`.
   - An error boundary and a 404.
8. **`apps/mobile`** (Expo + Expo Router): the same FSD structure, registry and slots; secure token storage (`expo-secure-store`); a splash screen; a forced-update screen from `/v1/config.minSupportedVersion`.
9. **`apps/admin`** (React + Vite):
   - A login shell with MFA.
   - A panel renderer skeleton that fetches panel definitions from the admin API. The panels themselves come in Phase 13.
10. **Auth flow wired end to end in web and mobile:** email → OTP → session → an empty home with tabs. This is the only feature in this phase, because every later screen needs a session.
11. **ESLint FSD boundary rules** for all apps, and a `pnpm dev` that runs the API and web together.
12. **`apps/landing`:** a static HTML placeholder page (content comes in Phase 15).

**Technical requirements**
- Server state lives only in TanStack Query. Global client state is limited to the session, flags and the socket status.
- Every screen handles loading, empty and error states.
- Bundle budget for web: initial JS under 200 KB gzipped.

**Files and modules created:** `packages/api-client/**`, `packages/realtime/**`, `packages/domain/**`, `packages/features-core/**`, `packages/ui-tokens/**`, `packages/ui-web/**`, `packages/ui-native/**`, `packages/i18n/**`, `apps/web/**`, `apps/mobile/**`, `apps/admin/**` (shell), `apps/landing/index.html`.

**Out of scope:** discovery, matching, chat, profile and settings screens (Phases 12–13), and admin panels.

**Testing and validation**
- **Unit tests:** api-client error mapping and refresh single-flight (concurrent 401s trigger one refresh); realtime reconnect and `sync` with a mock server; slot rendering filtered by flags.
- **Component tests:** for the UI kit in web.
- **One Playwright test** on web: sign in with an OTP from the development email adapter and land on the home shell.
- **Mobile:** the app runs in a development build on Android and iOS simulators; manual checklist results recorded in the report.
- **Boundary lint:** passes in all apps.

**Completion criteria**
- [ ] A user signs in on web and mobile against the local API and sees the home shell.
- [ ] The UI kit renders in light and dark themes.
- [ ] The slots render registered test features only when their flag is on.

**Report before approval:**
- Screenshots or short recordings of sign-in on web and mobile.
- The bundle size.
- The package dependency graph.
- Test output.
- The UI kit component list.

---

### Phase 12 — Frontend features I: onboarding, profile, discovery and matching (with backend integration)

**Estimated effort:** about 9 days

**Objective and outcomes**
- On web and mobile, against the real API, a new user completes onboarding.
- They build a profile with photos, swipe through their deck, match, and see their matches list.

**Depends on:** Phases 6, 7, 8 and 11.

**Tasks**
1. **Hooks** in `packages/features-core`:
   - `useMyProfile`, `useUpdateProfile`, `usePhotoUpload` (presign → upload with progress → confirm → poll status).
   - `useDeck` (prefetch the next page when 3 cards remain), `useSwipe` (optimistic removal, idempotent `swipeId`, rollback on error).
   - `useMatches` (infinite query), `useUnmatch`.
2. **Onboarding flow:**
   - Email → OTP (Phase 11) → date of birth (block under 18 with a clear message) → name, gender, interests → age range → photos (≥2, with reorder, delete, and per-photo status pending/approved/rejected) → notice and consent → done.
   - Progress persists if the app closes.
3. **Profile:** view own profile; edit fields; manage photos; render `profile.sections` and `profile.editor` slots (empty in v1).
4. **Discovery:** a deck widget with swipe gestures (mobile) and buttons plus keyboard (web); a profile card with photos and details; `deck.cardBadges` slot; an empty-deck state ("You're all caught up") with a time hint; report and block actions on a card (the screens call Phase 10 APIs).
5. **Match moment:** on `{ matched: true }` or a `match.new` socket event, show the match screen with "Send a message" (navigates to the chat route; the chat screen itself is Phase 13 and shows a placeholder here).
6. **Matches list:** new matches row plus a list; unmatch with confirmation.
7. **Analytics events:** onboarding steps completed, deck viewed, swipe, match.
    - Record them through a client `Analytics` adapter that only logs in v1. There is no new endpoint and no third-party SDK without approval.
    - Document the event list in `docs/analytics.md`.

**Technical requirements**
- Swipe interactions stay at 60 fps on a mid-range Android device (manual check).
- Images use the 400 px variant in decks and the 1080 px variant in detail views, with caching.
- No screen calls `fetch` directly; everything goes through `api-client` hooks.

**Files and modules created:** `packages/features-core/{profile,photos,deck,swipe,matches}/**`, `apps/web/src/{pages,widgets,features,entities}/**` and `apps/mobile/src/...` for onboarding, profile, discover and matches, `docs/analytics.md`.

**Out of scope:** chat screens, notification permission prompts, settings, safety centre (Phase 13).

**Testing and validation**
- **Hook tests:** with a mock API (optimistic swipe rollback, photo upload state machine).
- **Playwright (web):** new user onboarding with 2 photos (using the development moderation adapter) → deck → like → match, with two browser contexts.
- **Mobile:** a manual checklist on Android and iOS simulators, with results in the report.
- **Accessibility:** web pages pass axe checks with no serious violations.

**Completion criteria**
- [ ] Two new users, on web and mobile, onboard, see each other in their decks, like each other, and both see the match.
- [ ] Under-18 is blocked at onboarding.
- [ ] The Playwright suite is green.

**Report before approval:**
- A recording of the two-user flow.
- The Playwright output.
- The mobile checklist results.
- The axe results.
- Any API friction found (and whether it needed a contract change; additive only, approved first).

---

### Phase 13 — Frontend features II: chat, notifications, safety, settings and admin app

**Estimated effort:** about 9 days

**Objective and outcomes**
- Matched users chat in real time with delivery and read states and receive push notifications.
- Users can manage settings, privacy, blocks, reports, data export and account deletion.
- Moderators run the admin console.
- After this phase every v1 feature is usable end to end.

**Depends on:** Phases 9, 10, 11 and 12.

**Tasks**
1. **Chat hooks:**
   - `useConversations`.
   - `useMessages(conversationId)` with an infinite query backwards plus live appends from realtime.
   - `useSendMessage`: optimistic `sending` → `sent` (ack with seq) → `delivered` → `read`; retries keep the same `clientMsgId`.
   - `useMarkRead`.
2. **Chat UI:**
   - A conversation list (last message, unread count) and a conversation screen with a virtualised list, date separators and states.
   - A composer with the `chat.composerActions` slot, and `chat.messageRenderers` keyed by `kind` (`text` in v1).
   - A closed-conversation state, and report or block from the chat header.
3. **Offline and resume:** persist the last 50 messages per conversation on mobile. Resume runs `sync`, and the queued outgoing messages send after reconnect.
4. **Push notifications (mobile):**
   - Ask for permission at a sensible moment (after the first match, not at install).
   - Register the Expo push token through `POST /v1/devices`.
   - Deep-link a notification tap to the match or conversation.
   - Clear notifications for a conversation when it is opened.
5. **Settings:**
   - Notification preferences and quiet hours, and a blocked-users list.
   - A safety centre page with safety tips and how to report.
   - Data export (download), delete account (with a confirmation and a cooling-off explanation), log out, and log out of all devices.
   - A privacy notice and grievance contact.
   - The `settings.rows` slot.
6. **Admin app** (`apps/admin`): render the panels from the admin API definitions:
   - Reports queue with evidence and actions.
   - Photo review.
   - Verification reviews (ID card).
   - User lookup and bans.
   - Feature flags editor.
   - Audit log viewer.
   - Account deletions in progress.
   - Every action asks for confirmation and shows the audit entry it created.
7. **Web parity:** chat, settings and safety on web, plus web push (optional; only if it needs no new dependencies, otherwise note as a follow-up).

**Technical requirements**
- The message list stays smooth with 1,000 messages (virtualisation).
- No message body appears in push payloads or logs.
- Admin app routes are unreachable without an admin session.

**Files and modules created:** `packages/features-core/{chat,notifications,settings,safety}/**`, chat, settings and safety slices in `apps/web` and `apps/mobile`, panel implementations in `apps/admin/src/**`.

**Out of scope:** new features not in v1 (typing indicators, media messages, premium); deployment.

**Testing and validation**
- **Hook tests:** the message state machine; dedupe on replay; queued-send after reconnect.
- **Playwright:**
  - Two users chat in real time.
  - One goes offline, receives messages on return in order without duplicates.
  - A block closes the chat for both.
  - Admin bans a reported user, and the user is logged out.
- **Mobile manual checklist:** a push arrives when the app is backgrounded; tapping it opens the right conversation; permission-denied path works.
- **Accessibility:** axe on chat, settings and admin pages.

**Completion criteria**
- [ ] The complete v1 user journey from Part B.1 works on web and mobile against the local stack.
- [ ] The admin can process a report end to end.
- [ ] Every Playwright suite is green.

**Report before approval:**
- Recordings of the chat, push and moderation flows.
- The Playwright output.
- The mobile checklist.
- A list of any UI deviations from the design system.
- Known issues.

---

### Phase 14 — End-to-end testing, security, privacy and performance

**Estimated effort:** about 8 days

**Objective and outcomes**
- The system is proven correct, secure, private and fast enough before real users.
- This phase adds no new features. It finds and fixes defects against the beta targets.

**Depends on:** Phases 1–13.

**Tasks**
1. **Test completeness audit:** map every use case, route, socket event and consumer to its tests; fill gaps. Target: 85%+ line coverage on modules, 90%+ on platform, every invariant from Part B covered.
2. **Invariant suite:** run under concurrency, across processes:
   - Simultaneous likes create exactly one match.
   - No acked message is lost across a gateway or worker kill.
   - A block hides both users everywhere within one consumer cycle.
   - Account deletion erases everywhere.
   - Each event is processed once per consumer.
3. **Load tests (k6):**
   - Model the beta peak from Part B.7 at 10x: 470 req/s, 6,000 sockets, with 125 swipes/s and 31 messages/s.
   - Run against a staging-like environment (Docker Compose with resource limits matching the beta plan).
   - Record p50/p95/p99 per route, error rate, event-loop lag, outbox lag, queue ages and Postgres and Redis CPU.
4. **Chaos tests:** kill the API, gateway, worker and Redis during load; verify recovery and the absence of data loss; document the results.
5. **Performance fixes:** query plans for the top 10 queries (`EXPLAIN ANALYZE`), missing indexes, N+1 removal, cache hit rates. Every fix is measured before and after.
6. **Security review:**
   - Walk the threat table (see `docs/security/threat-model.md`, which you create from Part B and Phases 5–13).
   - Run `pnpm audit --prod`, and run a secrets scan on the git history.
   - Verify headers (helmet), CORS, cookies, rate limits, input limits, presign constraints, JWT rotation, admin MFA and IP allowlist, authorisation checks on every route (an automated test that calls every route with no token, a user token and the wrong user's resource ids), and SSRF/injection checks on any outbound URL.
7. **Privacy and DPDP readiness:**
   - A privacy notice text, versioned, shown at onboarding with consent recorded.
   - Data export completeness, and erasure completeness.
   - The retention jobs run as specified.
   - Logs carry no PII.
   - A breach-response runbook with a 72-hour reporting clock (`docs/runbooks/breach.md`).
   - Grievance contact published.
   - Flag every item that needs a lawyer's review.
8. **Accessibility pass** on web and mobile: contrast, labels, screen-reader order, dynamic type.

**Technical requirements**
- The beta SLOs from Part B.7 are met at 10x the beta peak.
- Zero high or critical vulnerabilities in production dependencies (or a documented, approved exception).

**Files and modules created/modified:** `apps/api/test/**`, `load/k6/*.js`, `docs/security/threat-model.md`, `docs/runbooks/{breach,incident,restore}.md`, `docs/performance/phase-14-report.md`, fixes across modules (each with a test).

**Out of scope:** new features; infrastructure provisioning (Phase 15).

**Testing and validation:** the tasks above are the validation. Every fix must have a test that failed before it.

**Completion criteria**
- [ ] Coverage targets met; the invariant suite is green 20 runs in a row.
- [ ] The k6 run at 10x the beta peak meets the SLOs, with the report committed.
- [ ] The chaos tests show no acked data loss.
- [ ] The security checklist is complete, with no open high-severity findings.
- [ ] The privacy checklist is complete, with legal-review items listed.

**Report before approval:**
- Coverage numbers.
- The k6 summary table.
- The chaos results.
- The security findings and fixes.
- The privacy checklist.
- Anything that needs the owner's decision.

---

### Phase 15 — Deployment, observability and closed beta launch

**Estimated effort:** about 6 days

**Objective and outcomes**
- Staging and production environments run the tested image, with monitoring, alerts, backups, a restore drill, runbooks, a landing page and the closed beta opened to the first campus.

**Depends on:** Phases 1–14.

**Tasks**
1. **Infrastructure:**
   - Provision on the approved beta hosts:
     - Render web service (`ROLE=all`, always-on Starter or above).
     - Postgres (Render Basic or Neon Launch).
     - Render Key Value (persistence off).
     - Cloudflare R2 bucket with a CDN custom domain and the `uploads/raw/` 1-day lifecycle rule.
     - Cloudflare DNS, WAF and Turnstile.
     - Resend or Brevo domain verification (SPF, DKIM, DMARC).
     - Expo EAS project and push credentials.
   - Document every resource in `docs/infrastructure.md`. Do not commit credentials; ask the owner to enter secrets into the host dashboards.
2. **Environments:** staging (synthetic seed only) and production. Config differs only through environment variables validated by `contracts/env.js`.
3. **CI/CD:**
   - On merge to `main`, build the image, deploy to staging, run migrations (expand step), run smoke tests and one Playwright flow.
   - Production promotion is manual, with an approval step.
   - Rolling deploy with health checks, automatic rollback on error-rate increase, and gateway socket draining.
4. **Observability:**
   - Sentry for API and apps, with release tracking.
   - OpenTelemetry traces exported.
   - Prometheus metrics scraped or pushed to Grafana (Grafana Cloud free tier).
   - Dashboards per module and a system overview.
   - Alerts (paging rules):
     - API error rate above 2% for 5 minutes.
     - Outbox lag above 60 s.
     - A non-empty dead-letter queue.
     - Redis memory above 70%.
     - A backup older than 26 hours.
     - Any free-tier quota above 80%.
5. **Backups and recovery:** nightly `pg_dump` to R2 (or host point-in-time recovery); run a restore drill into a scratch database and record its duration; write `docs/runbooks/restore.md`.
6. **Mobile release:** EAS builds for Android (internal testing track) and iOS (TestFlight); over-the-air update channel for staging and production; store listing basics (privacy labels).
7. **Web release:** deploy `apps/web` and `apps/admin` to Cloudflare, with the admin on a separate subdomain behind the IP allowlist. Write and deploy the static landing page with real content, Open Graph tags and links to the privacy policy and terms.
8. **Beta controls:**
   - Seed the launch college(s) and cluster in `platform.colleges`.
   - Flags for invite-only access (an allowlist by email domain plus an invite code), turned on for the first campus.
   - Admin accounts for moderators, with MFA set up.
9. **Launch checklist:** run `docs/runbooks/launch-checklist.md`, covering smoke tests in production, a real sign-up on each platform, a real match and chat between two test accounts, a push received, a report processed, and alerts tested by firing a test alert.
10. **Hand-over:** `docs/OPERATIONS.md` covers how to deploy, roll back, read dashboards, handle each alert, run the restore, rotate keys and add a campus.

**Technical requirements**
- Production uses TLS everywhere, the non-root container, and least-privilege database roles from Phase 2.
- The beta monthly cost is about $25–40. Report the actual figures.
- No production data in staging.

**Files and modules created/modified:** `.github/workflows/deploy.yml`, `render.yaml` (or equivalent infrastructure-as-config), `apps/landing/**`, `docs/infrastructure.md`, `docs/OPERATIONS.md`, `docs/runbooks/*.md`, `apps/mobile/eas.json`, `apps/mobile/app.config.js`.

**Out of scope:** scaling beyond the beta stage (Growth-stage changes are post-launch work), new features.

**Testing and validation**
- The production smoke suite passes.
- The restore drill succeeds and its time is recorded.
- A test alert reaches the owner.
- A rollback is rehearsed on staging.
- The launch checklist is fully ticked.

**Completion criteria**
- [ ] Production is live for the first campus behind invite-only flags.
- [ ] Monitoring, alerts, backups and runbooks are working and documented.
- [ ] Mobile builds are available to beta testers (internal testing track and TestFlight).
- [ ] `docs/PROGRESS.md` shows all 15 phases approved after this report is accepted.

**Report before approval:**
- The URLs (web, admin, landing, API health).
- The deploy and rollback logs.
- The restore drill time.
- Dashboard screenshots.
- The actual monthly cost breakdown.
- The completed launch checklist.
- A short list of recommended post-launch work: Growth-stage triggers and deferred follow-ups.

---

## Part D — Templates

### D.1 Phase Start Plan (send before coding; then stop)

```markdown
## Phase N — <name>: Start Plan

**Status of prerequisites:** Phases <list> approved ✅ (links to docs/phases/PHASE-XX.md)

**What I will build in this phase:**
- <bullet per task group, in order>

**What I will NOT build (out of scope):**
- <bullets>

**Files and modules I expect to create or modify:**
- <paths>

**New dependencies (need approval):** none | <package@version — reason>

**Decisions I need from you before starting:**
1. <question> (my recommendation: ...)

**How I will verify it:** <tests and checks from the phase section>

**Branch:** phase/NN-<short-name>

➡️ Reply "Approved: start Phase N" to begin, or tell me what to change.
```

### D.2 Phase Completion Report (send after verification; then stop)

```markdown
## Phase N — <name>: Completion Report

**Summary:** <2–3 sentences on what now works>

**Completion criteria:**
- [x] <criterion> — evidence: <test name / output / screenshot>
- [ ] <any unmet criterion> — reason and proposal

**What was built:** <files/modules, grouped>

**Tests and validation:**
- Commands run and results (pasted output, trimmed)
- Coverage: <numbers>
- Performance figures (where the phase asks for them)

**Decisions made:** <ADR links>

**Deviations from the roadmap:** none | <what, why>

**Known issues and risks:** <list>

**Suggested follow-ups (not done, need approval):** <list>

**How you can check it yourself:** <exact commands or steps>

**Pull request:** <link> · Branch: phase/NN-<short-name>

⏸️ I have stopped. Reply "Approved: Phase N complete" to close this phase.
I will not start Phase N+1 until you approve its start plan.
```

### D.3 ADR template (`docs/adr/NNNN-title.md`)

```markdown
# NNNN — <Decision title>
- Status: Proposed | Accepted (by owner on YYYY-MM-DD) | Superseded by NNNN
- Phase: N
## Context
<the problem and constraints>
## Decision
<what we chose>
## Alternatives considered
<options and why not>
## Consequences
<trade-offs, follow-ups>
```

### D.4 `docs/PROGRESS.md` format

```markdown
| # | Phase | Status | Start approved | Completed approved | Report |
|---|-------|--------|----------------|--------------------|--------|
| 1 | Repository foundation and tooling | Approved | 2026-11-22 | 2026-11-25 | phases/PHASE-01.md |
| 2 | Database architecture and migrations | Plan sent | — | — | — |
```

---

## Part E — Global Definition of Done (applies to every phase)

A phase is complete only when all of the following are true, in addition to its own completion criteria:

- [ ] Every task in the phase is implemented, and nothing outside the phase was added.
- [ ] `pnpm lint`, `pnpm test` and `pnpm check:boundaries` pass, and CI is green on the phase branch.
- [ ] New code has tests at the levels the phase lists, and every test was actually run.
- [ ] No secrets, PII or debug output in code, logs or commits.
- [ ] Module READMEs, ADRs, `CHANGELOG.md` and `docs/PROGRESS.md` are updated.
- [ ] `docs/phases/PHASE-NN.md` contains the completion report.
- [ ] The completion report has been sent, and Claude Code has **stopped and is waiting** for explicit approval.

**Final reminder to Claude Code:** one phase at a time. Ask before you start. Verify before you report. Stop after you report. Never proceed without the words "Approved: start Phase N" or "Approved: Phase N complete" from the project owner.
