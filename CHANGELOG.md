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

## Phase 5 — Identity and authentication module

### Added

- `modules/identity` (see its README):
  - college-email OTP sign-up and sign-in, with `SIGNUP_DETAILS_REQUIRED` that does not consume
    the code
  - 15-minute EdDSA access tokens, and 30-day rotating refresh tokens with reuse detection and a
    configurable grace window for retried refreshes (`REFRESH_REUSE_GRACE_SECONDS`, default 30)
    (ADR 0011)
  - logout, devices (list and remote sign-out), push-token registration
  - account deletion (`user.deleted.v1` once) and data export through the registry's exports
    hooks
  - a `user.banned.v1` consumer, and nightly retention of sessions, devices and erased accounts
- `POST /v1/auth/otp` fails closed: when Redis or the rate limiter is unavailable it returns 503
  `TEMPORARILY_UNAVAILABLE` and sends nothing.
- Email normalisation (trim, lowercase, drop `+tag`) and exact college-domain matching; no
  subdomains, so `alumni.<college domain>` is rejected.
- Configurable identity rate limits (`RATE_LIMIT_*`), with per-IP limits sized for shared campus
  IPs.
- `pnpm dev:keys` (`scripts/dev-keys.js`): local Ed25519 signing keys (`--write`, `--rotate`).
  It uses only Node's built-in crypto, so CI runs it before installing dependencies.
- Contracts (additive):
  - routes `POST /v1/auth/logout`, `GET /v1/me/devices` and `DELETE /v1/me/devices/{id}`
  - the error code `TEMPORARILY_UNAVAILABLE` (503), an optional `deviceId` on OTP requests, the
    `identity.retention` job and the `RATE_LIMIT_*` env variables
  - `ServiceError`, a pure coded error that application layers can throw
- Kernel additions:
  - `platform/rate-limit.js`, a Redis limiter with a fail-closed mode
  - `platform/routes.js`, a contract endpoint → Fastify route helper
  - registry `exports` collection and manifest `schedules`
  - readable messages for every identity error code
- ADR 0011 (token strategy and rate limits).

### Changed

- The idempotency store reports Redis outages as `TEMPORARILY_UNAVAILABLE` (it was a 500).
- `.env.example` documents the providers and limits. The CI Docker job generates signing keys
  with `node scripts/dev-keys.js --write`.

## Phase 6 — Profiles, media and photo pipeline

### Added

- `modules/profiles` (see its README): own profile read and edit, sections validated against
  the `sections` registry (empty in v1), profile completeness and `pending ↔ active` status,
  `profile.updated.v1` on every change, cached profile cards (`api.getCards`, Redis
  `profiles:card:{userId}`, 10 minutes, invalidated on change), the `profiles.cardFields`
  pipeline, consumers of `user.created.v1`, `user.deleted.v1` and the photo events, and data
  export.
- `modules/media` (see its README): presigned uploads with the exact size and type signed,
  confirm, the image worker (magic bytes, 50 MP limit, EXIF and GPS stripped, WebP at 1080 and
  400 px with shrink-on-load, content-check port with a development adapter), publish under
  `photos/{photoKey}/{photoId}_{size}.webp`, release on photo deletion, erase on account
  deletion, nightly retention of finished upload rows, and data export.
- `DELETE /v1/me/photos/{id}` (additive contract, owner decision): idempotent; the files are
  deleted, including a photo still being processed.
- SeaweedFS (`chrislusf/seaweedfs:4.54`) as the local S3 server in Compose and Testcontainers,
  `infra/seaweedfs/s3.json`, and `pnpm storage:init` to create the local bucket.
- Env: `PHOTOS_MAX`, `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_SECONDS`, `IMAGE_WEBP_QUALITY`,
  `IMAGE_MAX_PIXELS`; the `media.retentionTick` job contract.
- Migrations (expand-only): `profiles.photos` status `deleted` (tombstones), and
  `media.uploads.photo_key`.
- Kernel additions: event consumers can `emit` into the outbox and register `afterCommit`
  hooks; the registry collects section types; `lockKey` advisory locks; a per-queue worker
  concurrency override (`media` from `IMAGE_WORKER_CONCURRENCY`).
- Dependencies (approved): `sharp@0.35.5`, `@aws-sdk/client-s3@3.1175.0`,
  `@aws-sdk/s3-request-presigner@3.1175.0`.
- ADR 0012 (media storage, photo keys and the image pipeline).

### Changed

- `IMAGE_WORKER_CONCURRENCY` defaults to 1 (was 2), for a 512 MB instance.
- Production requires `R2_ACCOUNT_ID` unless `R2_ENDPOINT` is set (and `R2_ENDPOINT` stays
  refused in production).
- The seed builds photo keys as `photos/{photoKey}/{photoId}_{size}.webp` with a random key per
  photo, never the user id. It stays deterministic, but its generated values differ from Phase 5's
  because the generator now also draws the photo keys.
- The modules list is now identity, profiles, media.

## Phase 7 — Safety core and discovery engine

### Added

- `modules/safety` (part 1; see its README):
  - `POST /v1/blocks` (idempotent, one `user.blocked.v1` per new block), and `unblock`
    (admin) and `listBlocked` use cases without routes yet
  - `blockPolicy.isBlocked` and `blockedAmong` (Redis `safety:blocked:{uid}`, trusted only once
    loaded from Postgres), `isBanned` and `bannedAmong`
  - the `safety.contentChecks` pipeline (fail closed) with a `ModerationProvider` port: Amazon
    Rekognition in `ap-south-1` (moderation labels and face age ranges) and a development
    adapter
- `modules/discovery` (see its README):
  - a candidate source over the published views (one cluster, mutual preferences, swipe, block
    and active-account exclusions, up to 500, on the read replica when configured)
  - the `discovery.candidateFilters` and `discovery.scorers` pipelines with the v1 steps, each
    in its own file
  - `HandTunedRanker` with configurable weights, an exposure-cap gate and diversified first
    10 slots
  - the deck worker (`deck-{uid}` job id), `GET /v1/deck`, `api.nextCards` and `wasServed`,
    `deck.served.v1` per page, and consumers for blocks, matches, profile updates and approved
    photos
- Media: photos are moderated through `safety.contentChecks`; a `review` verdict holds the photo
  `in_review` under the private `review/` prefix, and `media.api.resolveReview` decides it.
- `db.read(module, fn, { replica: true })` uses `DATABASE_REPLICA_URL` when set.
- `identity.api.getUsersByPublicIds`.
- `pnpm --filter @vouch/api bench:deck`: deck latency over 1,000 requests.
- Env: `MODERATION_AWS_*`, `MODERATION_*_CONFIDENCE`, `MODERATION_FACE_AGE_CHECK`,
  `MODERATION_MINOR_AGE`, `MODERATION_ENDPOINT` (test-only), `DISCOVERY_*`.
- Contracts (additive): the processed image bytes on the `safety.contentChecks` input, and
  `Candidate.collegeId`.
- Migration (expand-only): `media.uploads.status` gains `in_review`.
- Dependency (approved): `@aws-sdk/client-rekognition@3.1175.0`.
- ADRs 0013 (photo moderation) and 0014 (discovery ranking).

### Changed

- Media's development `ContentCheck` is replaced by the pipeline; `MODERATION_PROVIDER` is
  `dev` or `rekognition`.
- The modules list is now identity, profiles, media, safety, discovery.

## Phase 8 — Matching module

### Added

- `modules/matching` (see its README):
  - `POST /v1/swipes`: idempotent on `swipeId`; the target must have been served; a like runs
    one transaction with the pair lock, a block re-check and `createOrGet` on the canonical
    pair, so a mutual like creates exactly one match and one `match.created.v1`
  - a blocked pair is never revealed: the swipe answers like a pass and stores nothing
  - passes buffered in Redis and written in batches of up to 500 every 5 s
    (`matching.flushPasses`, `matching.writePasses`); a filter contributed to
    `discovery.candidateFilters` excludes passes still in the buffer
  - `GET /v1/matches` (cursor pagination, hydrated cards) and `POST /v1/matches/{id}/unmatch`
    (permanent, idempotent, one `match.unmatched.v1`)
  - `api.areMatched`, `getMatch`, `likesIn` (count only); consumers for blocks and account
    deletion (swipes deleted, matches anonymised); nightly pass retention per partition;
    export of swipes and matches
- `apps/api/test/invariants/simultaneous-likes.test.js`: 1,000 pairs liking each other at the
  same instant.
- `profiles.api.isActive`; the `matching.flushPasses` and `matching.retentionTick` job
  contracts; readable messages for `NOT_SERVED` and `NOT_MATCHED`.
- ADRs 0015 (rate-limit keys and proxy trust) and 0016 (matching concurrency).

### Changed

- **Global rate limit (fixes Phase 4):** per user for signed-in requests
  (`RATE_LIMIT_USER_MINUTE`, default 300) and per client IP otherwise
  (`RATE_LIMIT_IP_MINUTE`, default 1,000), including requests with a missing or bad token.
  Authentication is split into `authenticate` and `enforce` so the limiter counts every request.
- **Client IP (fixes Phase 4):** `CF-Connecting-IP` and `X-Forwarded-For` are believed only
  from `TRUSTED_PROXIES` (empty by default); otherwise the socket address is used. Modules use
  `request.clientIp`.
- `bench:deck` no longer needs per-user forwarded addresses.
- The modules list is now identity, profiles, media, safety, discovery, matching.

## Phase 9 — Realtime chat and WebSocket gateway

### Added

- Socket gateway (`apps/api/src/platform/ws.js`, roles `ws` and `all`; ADR 0017):
  - Socket.IO with WebSocket transport only and the Redis adapter
  - the handshake JWT check, and a `user:{id}` room per socket
  - every event validated against the contracts, with `{ ok, … }` acks
  - module handlers through the manifest `socket.handlers` key
  - `auth.refresh`, and `auth.expired` after expiry plus `SOCKET_REFRESH_GRACE_SECONDS`
  - a gradual drain on SIGTERM
  - `platform.sockets.emitToUser` for every role, through the Redis emitter
- `modules/chat` (see its README):
  - the conversation id is the match id, opened by the `match.created.v1` consumer
    (`match.new` to both members)
  - `message.send` is exactly once per `clientMsgId`, with a gapless seq per conversation
    under a row lock; the ack and `message.new` go out after commit
  - `sync` replay, plus read and delivered cursors that only move forward
  - the fail-closed `chat.messageFilters` pipeline: length, link limiter and block check
  - `message.created.v1` when the recipient is offline
  - conversations close on unmatch, block and deletion; blocks are never revealed
  - nightly purge 30 days after close; export of sent messages
  - `GET /v1/conversations` and `GET /v1/conversations/{id}/messages`
  - presence, exposed only as `isActiveRecently`
- `safety.api.blocks.blockersBetween`, which the closing notices use.
- Contracts (additive):
  - the `auth.refresh` client event and the `auth.expired` server event
  - the `chat.retentionTick` job
  - an optional `reason` on a `chat.messageFilters` refusal
  - env `SOCKET_REFRESH_GRACE_SECONDS`, `RATE_LIMIT_MESSAGES_MINUTE`,
    `CHAT_MAX_LINKS_PER_MESSAGE` and `CHAT_LINKS_AFTER_MESSAGES`
- Invariants: gateway failover (SIGKILL mid-stream), idempotent send, closed and blocked
  conversations refused, and a 500-socket load smoke on two gateway processes.
- ADR 0017 (socket gateway and chat delivery).

### Changed

- **Readable error messages (owner decision):** every `AppErrorCode` now has a readable
  message, and a test fails when one is missing.
- Fastify client errors map to stable codes: a wrong content type is
  `UNSUPPORTED_MEDIA_TYPE` (415), and any other Fastify 4xx is `VALIDATION_FAILED`, never 500.
- `listMatches` returns `conversationId` (equal to the match id).
- The access-token principal carries `expiresAt`.
- The modules list is now identity, profiles, media, safety, discovery, matching, chat.

## Phase 10 — Notifications, moderation and admin backend

### Added

- **`modules/notifications`** (ADR 0019):
  - Expo push over `fetch` (chunks of 100, receipts, invalid tokens removed) and a development
    log provider
  - the templates registry: `match.new`, `message.new`, `likes.digest`. Pushes never carry a
    body, a name or an internal id.
  - preferences and time-zone-aware quiet hours
  - at most one message push per conversation per 30 s
  - a block cancels queued pushes
  - a staff alert email for new reports
  - the daily likes digest
  - a delivery log, kept 90 days
- **Safety part 2** (ADR 0020):
  - reports with evidence snapshots, with chat's last 20 messages through the new fail-closed
    `safety.reportEvidence` pipeline
  - auto-hide at 3 distinct reporters in 7 days
  - moderation actions: dismiss, warn, hide, unhide, ban
  - bans and lifting them (`user.unbanned.v1`), plus nightly expiry
  - the ID-card fallback: private uploads, review and `verification.decided.v1`
  - the photo review queue, and the 48-hour review alert (`media.reviewAlert`)
  - repeat-offence system reports
  - erasure and retention
- **Identity:**
  - the ID-card sign-up (`pending_review`), with a `pr` token claim that limits such accounts
    to the verification routes (HTTP and sockets)
  - the ban-evasion record (`identity.banned_emails`)
  - `user.unbanned.v1` and `verification.decided.v1` consumers
  - push-token API
- **`modules/admin`** (ADR 0018):
  - `admin:create` (scrypt password and an AES-256-GCM-sealed TOTP secret)
  - sign-in with email, password and RFC 6238 TOTP (`node:crypto`, replay refused)
  - every admin route from the contracts, plus panels, overdue deletions and unblock
  - per-call account and role checks
  - one audit entry per action, purged after 2 years
  - panels from module manifests (`admin.panels`)
  - flags with a `config.changed` broadcast
- **Platform:**
  - `GET /v1/config`
  - the nightly consistency job (`vouch_consistency_violations`), with column-level grants for
    `vouch_platform`
  - `user.deleted.v1` completion recorded in `platform.deletion_tasks`
  - socket `broadcast`
  - generic gauges
  - the template and panel registries
  - job queues taken from the contracts
- **Matching:** `user.banned.v1` ends the banned user's matches; `pendingLikes` for the digest.
- **Contracts (additive):**
  - the admin login, panels, overdue-deletion and unblock endpoints
  - the ID-card endpoints
  - `verification` and `signup.collegeId` on sign-in
  - `selfieImageUrl` on verification reviews
  - two events, six jobs and the `safety.reportEvidence` pipeline
  - env: `ADMIN_TOTP_KEY`, `ADMIN_TOKEN_TTL_MINUTES`, `PUSH_MESSAGE_BATCH_SECONDS`,
    `ADMIN_ALERT_EMAIL`, `REPORT_AUTOHIDE_*`, `REPORTS_PER_DAY`, `PHOTO_REJECTIONS_FOR_REVIEW`
    and `ID_CARD_FALLBACK`
- **Tests:** the full backend scenario, and admin, safety and notifications integration on a
  shared harness; RFC 6238 vectors and the semaphore.

### Changed

- **Fix (kernel):** concurrent consumer transactions are bounded to half the database pool.
  Without that, consumers that read through another module's API could exhaust the pool and
  deadlock (seen with notifications and chat consumers under load).
- **Fix (discovery):** a deck rebuild keeps the served set, so cards served just before a refill
  stay swipeable. Before, swipes on them failed with `NOT_SERVED`.
- `pnpm dev:keys --write` also writes `ADMIN_TOTP_KEY`.
- The modules list now ends with notifications and admin.

## Phase 11 — Frontend foundation

### Added

- **Shared packages:**
  - `i18n`: English strings; `t()` throws on a missing key
  - `domain`: the 18+ age rule, validators, formatting and version comparison
  - `ui-tokens`: a neutral palette in light and dark, spacing, type scale, radii and motion,
    as JS and CSS variables, with a WCAG AA contrast test
  - `api-client`: fetch functions generated from the contracts (no runtime zod),
    `X-App-Version`, automatic `Idempotency-Key`, `ApiError`, a single-flight refresh, cookie
    (web) or body (mobile) transport, and TanStack Query keys
  - `realtime`: a socket.io-client wrapper with a token refresh before expiry, a reconnect
    after a server disconnect, `sync` with cursors on every connect, once-only delivery, an
    outbox retried with the same `clientMsgId`, and a Query cache adapter
  - `features-core`: the slot registry (`defineClientFeature`, filtered by flags), the sign-in
    flow, and the React providers and hooks (`useSession`, `useConfig`, `useFlags` and
    `<Slot>`)
  - `ui-web` and `ui-native`: the accessible UI kits (Button, Input, OtpInput, Avatar, Card,
    Modal/Sheet, Toast, EmptyState, Skeleton, ListItem and Badge). The web kit ships a
    generated `styles.css`.
- **`apps/web`:**
  - React 19, Vite 8, React Router and TanStack Query in Feature-Sliced Design
  - an error boundary, a 404, the lazy `/ui-kit` page, and sign-in with the emailed code
  - the home shell, with tabs from the `home.tabs` slot
  - the dev and preview servers proxy `/v1` and `/socket.io` to the API
- **`apps/mobile`:**
  - Expo SDK 58 with Expo Router (`src/routes`)
  - the refresh token in the secure store
  - the splash screen held until the session is restored
  - a forced-update screen, the same sign-in flow and the home tabs
- **`apps/admin`:** staff sign-in (email, password and TOTP; the token is kept in memory
  only) and the panel list.
- **`apps/landing`:** a static placeholder.
- **Checks:**
  - JSX in `tsc --checkJs` (`tsconfig.web.json`, `apps/mobile/tsconfig.json`) and in ESLint
  - Feature-Sliced Design boundaries for every app in dependency-cruiser
  - a jsdom Vitest setup
  - Playwright end-to-end against the real API (Testcontainers), with axe in light and dark
  - the 200 KB gzipped initial-JS budget
  - the Expo export for Android and iOS
  - new `web` and `mobile` CI jobs
- **Docs:** ADR 0021 (frontend architecture) and a README for every new package and app.

## Phase 12 — Frontend features I: onboarding, profile, discovery and matching

### Added

- **API (additive):**
  - `PUT /v1/me/photos/order` (the exact set of current photos, one transaction)
  - `GET /v1/me/likes/count` (a number only)
- **Storage:** a bucket CORS rule (`PUT` with `content-type` from `CORS_ORIGINS`), applied by
  `pnpm storage:init`; the R2 rule is documented in the media README.
- **`scripts/measure-variants.js`:** runs photos through the production image pipeline and
  prints the variant sizes.
- **`features-core`:** hooks for profile, photo uploads (resize port, progress, confirm, poll,
  resume), photo delete and reorder, the deck (prefetch at 3) and swipes (optimistic, stable
  `swipeId`, rollback), matches, unmatch, the likes count, report and block, and onboarding
  (resumable). Also allow-listed analytics and a realtime event hub.
- **Web:**
  - onboarding, the photo manager, the discover deck (buttons and ←/→), the match moment,
    matches, profile editing and the chat placeholder
  - Playwright: two users onboard with browser uploads to SeaweedFS (CORS), match and
    unmatch; under 18 is refused; axe runs on every new page in light and dark
- **Mobile:** the same screens with the Expo image picker, image manipulator and image cache,
  plus a `PanResponder` swipe deck.
- **Docs:** ADR 0022 and `docs/analytics.md`.

### Changed

- The Phase 11 sign-in now lands in onboarding until the profile is set up.
- The `ui-native` `Button` accepts an `accessibilityLabel` for icon buttons.

## Phase 13 — Frontend features II: chat, notifications, safety, settings and admin app

### Added

- **API (additive):**
  - `receipt.updated` socket event to the sender (cursors only)
  - `listMessages` `beforeSeq`/`prevBeforeSeq` and `peerDeliveredSeq`/`peerReadSeq`
  - `GET /v1/me/notification-prefs`
  - `GET /v1/me/blocks` and `DELETE /v1/blocks/{userId}`
- **`features-core`:**
  - chat hooks: conversations; backward history; the send state machine (sending → sent →
    delivered → read, failed and retry with the same `clientMsgId`); mark-read while
    visible
  - settings hooks: prefs, blocks, export, sign out everywhere, delete
  - push: the registration port and notification-tap targets
  - the mobile offline message cache (last 50 per conversation)
- **Realtime:** delivered reports once per new seq, `receipt.updated`, and `message.read`
  without an ack. Conversation-list refreshes during a burst are coalesced (at most one a
  second).
- **Web:**
  - chat: the list with unread counts; a virtualised conversation with date separators and
    states; the composer slot; renderers by kind; the closed state; report and block in the
    header
  - settings: notifications and quiet hours, blocked people, export, log out everywhere,
    delete account
  - the safety centre and privacy pages
- **Mobile:** the same, plus push (permission after a match, token registration, taps open the
  chat, clearing on open) and the offline cache.
- **Admin:**
  - every panel rendered from its definition, with confirmed actions that show their audit
    entry
  - user lookup with ban, and the flag toggle
- **Playwright:**
  - live chat with read states, offline catch-up (in order, once), and sending while offline
  - a block closes the chat; settings round trip
  - 1,000 messages stay virtualised
  - report → admin ban → user signed out
  - axe on every new page
- **Docs:** ADR 0023.

### Changed

- The "New" matches row shows matches with no messages yet (was: the last 3 days).
- The admin JSON field is keyboard-focusable (axe `scrollable-region-focusable`).

### Fixed

- A burst of messages no longer refetches the conversation list per message.
- Two flaky tests: the photo-reorder test no longer assumes upload order, and the
  invalid-push-token test waits for the delivery's final status.

## Phase 14 — End-to-end testing, security, privacy and performance

### Added

- **Share read receipts** (owner, ADR 0024): `GET`/`PUT /v1/me/chat-settings`, off by default
  and reciprocal. The server stops read receipts and the peer read cursor unless both people
  share. It is a settings row on web and mobile, included in the export and erased with the
  account.
- **Audit integrity** (owner, ADR 0025): every staff change and its audit entry commit in the
  same transaction. The owning module emits `audit.recorded.v1` (additive) through its outbox,
  and admin stores it idempotently. Flags and sign-in write the row in their own transaction.
  A failure-injection test proves an action never happens without its entry.
- **Admin sessions** (owner, ADR 0026): `POST /v1/admin/auth/logout`; every admin token carries
  a session id, checked on every admin request, so logout and revocation take effect at once.
- **Sensitive user routes** (ADR 0026): device management, deletion, export and self-unblock
  check that the session is still live, so a signed-out session's access token cannot use them.
- **Security review** (`docs/security/threat-model.md`):
  - an authorisation matrix over every route (no token, the wrong kind of token, a forged
    token) and a wrong-user ids test
  - header, CORS and injection tests
  - a 64 KB HTTP body limit and a 16 KB socket message limit
  - `pnpm audit --prod` clean, using overrides for `glob` and `minimatch`
  - a secrets scan (`pnpm check:secrets --history`); the audit and the scan now run in CI
- **Deletion erases everywhere:** chat replaces a deleted member's id in their conversations
  with a tombstone. The nightly consistency check now covers every table that holds a user id
  (`chat.member_settings`, `chat.conversations`, `profiles.profile_sections`,
  `safety.photo_rejections` added). `test/db/user-data.test.js` keeps that list complete.
- **Coverage:** thresholds of 85% (lines) on modules and 90% on the platform. Measured:
  modules 94.8%, platform 97.4%.
- **New invariants:**
  - a worker killed mid-burst: no event lost, each processed once per consumer
  - a block hides both users everywhere within one consumer cycle
  - deletion erases everywhere
  - gateway memory per idle socket
