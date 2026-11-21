## Phase 3 — API, event and socket contracts: Completion Report

**Summary:** `packages/contracts` defines every v1 boundary as zod 4 schemas, with zod as its
only runtime dependency:

- 35 REST endpoints, including the 14 admin endpoints
- 4 client → server and 4 server → client socket events
- 13 domain events, with their envelope
- 7 job payloads and 5 pipeline step shapes
- the section registry format, `GET /v1/config` and feature-flag rules
- the environment schema

`openapi.json` (OpenAPI 3.1) and a JSON Schema snapshot (`schemas.json`) are generated from the
schemas and committed. A contract-diff check in CI fails on any breaking change against `main`.

**Completion criteria:**

- [x] Every endpoint, socket event, domain event and job in Tasks 2–4 has a schema and a fixture.
      Evidence: `test/schemas.test.js` asserts that the fixture keys equal the schema registry
      exactly. Every schema (123 entries, including pipelines, config, env and common blocks)
      parses its valid examples and rejects its invalid ones.
- [x] `openapi.json` is generated and committed. It validates with
      `@apidevtools/swagger-parser`, and CI runs `pnpm contracts:check` to fail on a stale file.
- [x] The contract-diff check is in CI (`pnpm contracts:diff --base origin/main`).

**Endpoints:**

| Method | Path                                           | Module        | Auth     | Idempotency     | Success | Endpoint-specific errors                                                            |
| ------ | ---------------------------------------------- | ------------- | -------- | --------------- | ------- | ----------------------------------------------------------------------------------- |
| POST   | `/v1/auth/otp`                                 | identity      | public   | Idempotency-Key | 200     | CAPTCHA_FAILED, EMAIL_DOMAIN_NOT_ALLOWED                                            |
| POST   | `/v1/auth/verify`                              | identity      | public   | Idempotency-Key | 200     | OTP_EXPIRED, OTP_INVALID, SIGNUP_DETAILS_REQUIRED, UNDERAGE, OTP_ATTEMPTS_EXHAUSTED |
| POST   | `/v1/auth/refresh`                             | identity      | public   | Idempotency-Key | 200     | REFRESH_TOKEN_INVALID, REFRESH_TOKEN_REUSED                                         |
| DELETE | `/v1/me`                                       | identity      | user     | —               | 202     | —                                                                                   |
| GET    | `/v1/me/export`                                | identity      | user     | —               | 200     | —                                                                                   |
| POST   | `/v1/devices`                                  | identity      | user     | Idempotency-Key | 200     | —                                                                                   |
| GET    | `/v1/config`                                   | platform      | optional | —               | 200     | —                                                                                   |
| GET    | `/v1/me/profile`                               | profiles      | user     | —               | 200     | —                                                                                   |
| PATCH  | `/v1/me/profile`                               | profiles      | user     | —               | 200     | —                                                                                   |
| PUT    | `/v1/me/profile/sections/{type}`               | profiles      | user     | —               | 200     | UNKNOWN_SECTION_TYPE                                                                |
| POST   | `/v1/media/uploads`                            | media         | user     | Idempotency-Key | 201     | PHOTO_LIMIT_REACHED, FILE_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE                         |
| POST   | `/v1/media/uploads/{id}/confirm`               | media         | user     | path: id        | 202     | NOT_FOUND, UPLOAD_NOT_UPLOADED                                                      |
| GET    | `/v1/deck`                                     | discovery     | user     | —               | 200     | PROFILE_INCOMPLETE                                                                  |
| POST   | `/v1/swipes`                                   | matching      | user     | body: swipeId   | 200     | BLOCKED, NOT_SERVED, PROFILE_INCOMPLETE                                             |
| GET    | `/v1/matches`                                  | matching      | user     | —               | 200     | —                                                                                   |
| POST   | `/v1/matches/{id}/unmatch`                     | matching      | user     | path: id        | 200     | NOT_MATCHED, NOT_FOUND                                                              |
| GET    | `/v1/conversations`                            | chat          | user     | —               | 200     | —                                                                                   |
| GET    | `/v1/conversations/{id}/messages`              | chat          | user     | —               | 200     | NOT_A_MEMBER, NOT_FOUND                                                             |
| POST   | `/v1/blocks`                                   | safety        | user     | body: targetId  | 200     | NOT_FOUND                                                                           |
| POST   | `/v1/reports`                                  | safety        | user     | Idempotency-Key | 201     | NOT_A_MEMBER, NOT_FOUND                                                             |
| PUT    | `/v1/me/notification-prefs`                    | notifications | user     | —               | 200     | —                                                                                   |
| GET    | `/v1/admin/reports`                            | admin         | admin    | —               | 200     | —                                                                                   |
| GET    | `/v1/admin/reports/{id}`                       | admin         | admin    | —               | 200     | NOT_FOUND                                                                           |
| POST   | `/v1/admin/reports/{id}/actions`               | admin         | admin    | Idempotency-Key | 200     | NOT_FOUND, CONFLICT                                                                 |
| GET    | `/v1/admin/photo-reviews`                      | admin         | admin    | —               | 200     | —                                                                                   |
| POST   | `/v1/admin/photo-reviews/{id}/decision`        | admin         | admin    | Idempotency-Key | 200     | NOT_FOUND, CONFLICT                                                                 |
| GET    | `/v1/admin/verification-reviews`               | admin         | admin    | —               | 200     | —                                                                                   |
| POST   | `/v1/admin/verification-reviews/{id}/decision` | admin         | admin    | Idempotency-Key | 200     | NOT_FOUND, CONFLICT                                                                 |
| GET    | `/v1/admin/users/{userId}`                     | admin         | admin    | —               | 200     | NOT_FOUND                                                                           |
| GET    | `/v1/admin/bans`                               | admin         | admin    | —               | 200     | —                                                                                   |
| POST   | `/v1/admin/bans`                               | admin         | admin    | Idempotency-Key | 201     | NOT_FOUND, CONFLICT                                                                 |
| POST   | `/v1/admin/bans/{id}/lift`                     | admin         | admin    | path: id        | 200     | NOT_FOUND                                                                           |
| GET    | `/v1/admin/audit-log`                          | admin         | admin    | —               | 200     | —                                                                                   |
| GET    | `/v1/admin/flags`                              | admin         | admin    | —               | 200     | —                                                                                   |
| PUT    | `/v1/admin/flags/{key}`                        | admin         | admin    | —               | 200     | —                                                                                   |

Every endpoint can also return `VALIDATION_FAILED`, `APP_VERSION_UNSUPPORTED`, `RATE_LIMITED`
and `INTERNAL`. `user` routes add `UNAUTHENTICATED` and `ACCOUNT_BANNED`; `admin` routes add
`UNAUTHENTICATED`, `FORBIDDEN`, `MFA_REQUIRED` and `IP_NOT_ALLOWED`.

**Socket events:**

| Direction       | Event                 | Payload                                                                         | Ack                                                                   |
| --------------- | --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Client → server | `message.send`        | `{ conversationId, clientMsgId, kind, body }`                                   | `{ ok: true, clientMsgId, seq, createdAt }` or `{ ok: false, error }` |
| Client → server | `message.read`        | `{ conversationId, seq }`                                                       | none                                                                  |
| Client → server | `message.delivered`   | `{ conversationId, seq }`                                                       | none                                                                  |
| Client → server | `sync`                | `{ cursors: [{ conversationId, lastSeq }] }`                                    | `{ ok: true, messages, truncated }` or `{ ok: false, error }`         |
| Server → client | `message.new`         | Message `{ conversationId, seq, clientMsgId, senderId, kind, body, createdAt }` | client replies `message.delivered`                                    |
| Server → client | `match.new`           | `{ matchId, conversationId, user }`                                             | none                                                                  |
| Server → client | `conversation.closed` | `{ conversationId, reason }`                                                    | none                                                                  |
| Server → client | `config.changed`      | `{}`                                                                            | none                                                                  |

**Domain events** (envelope `{ id, name, version, occurredAt, traceId, payload }`):

| Event                | Producer  | Payload                                                                      |
| -------------------- | --------- | ---------------------------------------------------------------------------- |
| `user.created.v1`    | identity  | userId, publicId, collegeId, clusterId, birthDate, status, createdAt         |
| `user.deleted.v1`    | identity  | userId, deletedAt, eraseBy                                                   |
| `profile.updated.v1` | profiles  | userId, status, changed[], updatedAt                                         |
| `photo.uploaded.v1`  | media     | uploadId, userId, rawKey, contentType, confirmedAt                           |
| `photo.approved.v1`  | media     | photoId, uploadId, userId, keys { w400, w1080 }, approvedAt                  |
| `photo.rejected.v1`  | media     | photoId (nullable), uploadId, userId, reason, rejectedAt                     |
| `deck.served.v1`     | discovery | viewerId, targetIds[1..10], servedAt                                         |
| `match.created.v1`   | matching  | matchId, userLow, userHigh, firstLikerId, createdAt                          |
| `match.unmatched.v1` | matching  | matchId, userLow, userHigh, unmatchedBy (nullable), unmatchedAt              |
| `message.created.v1` | chat      | conversationId, seq, senderId, recipientId, kind, createdAt (never the body) |
| `user.blocked.v1`    | safety    | blockerId, blockedId, blockedAt                                              |
| `report.created.v1`  | safety    | reportId, reporterId, targetId, context, reason, createdAt                   |
| `user.banned.v1`     | safety    | userId, banId, expiresAt (nullable), bannedAt                                |

**Jobs:** `discovery.buildDeck` (fast), `matching.writePasses` (bulk), `matching.purgePasses`
(bulk), `media.processImage` (media), `notifications.sendPush` (external),
`notifications.checkReceipts` (external), `platform.retention` (bulk).

**Pipelines:** `discovery.candidateFilters`, `discovery.scorers`, `chat.messageFilters` (fail
closed), `safety.contentChecks` (fail closed), `profiles.cardFields`.

**OpenAPI:** [`packages/contracts/openapi.json`](../../packages/contracts/openapi.json): OpenAPI
3.1.0, 33 paths and 35 operations. Each operation carries `x-idempotency` and `x-error-codes`.

**What was built:**

- `packages/contracts/src/**`: `common/` (ids, codes, errors, headers, pagination, entities),
  `http/` (one file per module, plus `defineEndpoint`, which refuses inconsistent definitions at
  import time), `socket/`, `events/` (`defineEvent`), `jobs/`, `pipelines/`, `sections/`,
  `config/`, `env.js`
- `packages/contracts/tooling/`: `buildOpenApi`, `buildSchemaSnapshot` and `diffSnapshots`
  (pure)
- `scripts/contracts-generate.js` (`pnpm contracts:generate` / `contracts:check`) and
  `scripts/contracts-diff.js` (`pnpm contracts:diff`)
- `ci.yml`: generated-contracts drift check, plus a contract diff against `origin/main`
- Docs: `packages/contracts/README.md` (conventions, auth-flow notes, versioning rules),
  `docs/adr/0007-contract-versioning.md`, `docs/data-model.md` notes, `CHANGELOG.md`, `README.md`

**Tests and validation** (clean clone; Node v24.22.3, pnpm 10.34.9):

```
pnpm lint                 → exit 0 (4 tasks, --max-warnings 0)
pnpm format:check         → All matched files use Prettier code style!
pnpm typecheck            → exit 0
pnpm check:boundaries     → ✔ no dependency violations found (95 modules, 229 dependencies cruised)
pnpm contracts:check      → Generated contracts are up to date.
pnpm contracts:diff       → No contract snapshot on origin/main; nothing to compare (first version).
pnpm test                 → 9 s
  @vouch/contracts  Test Files 5 passed · Tests 349 passed
  @vouch/config     Test Files 2 passed · Tests 4 passed
  @vouch/api        Test Files 8 passed · Tests 50 passed
```

Contract tests (349):

- **`schemas.test.js`:** fixture keys equal the schema registry exactly, and each of the 123
  schemas parses its valid examples and rejects its invalid ones.
- **`strictness.test.js`:** every emitted schema (responses, acks, server events, domain
  events, pipeline outputs, config, error envelope) is strict.
- **`openapi.test.js`:**
  - the document is valid OpenAPI 3.1, with one operation per endpoint
  - every POST documents its idempotency key
  - the committed files match the generator
- **`diff.test.js`:**
  - 7 additive changes pass (new optional field, new response field, new endpoint, `v2` event
    beside `v1`, new response enum value, relaxed limit, new error code)
  - 14 breaking changes fail (removed field, narrowed type, renamed event, new required request
    field, removed enum value, tightened limit, response field made optional, removed
    endpoint, changed path, tightened auth, removed socket event, removed error code, removed
    ack union option, removed job field)
- **`definitions.test.js`:** consistency checks on endpoint and event definitions, plus the
  owner decisions (gender codes, message identity, ack shape, `SIGNUP_DETAILS_REQUIRED` and
  cookie documentation).

Contract diff, run end to end against a real git base:

```
additive (new optional swipe field)        → No breaking contract changes against HEAD.  exit 0
breaking (removed field + required field)  → 2 breaking contract change(s) against HEAD:
                                               ✗ http.swipe.response.matchId: removed
                                               ✗ http.blockUser.request.body.reason: new required field
                                             exit 1
```

Two real gaps were found and fixed while verifying the tests themselves:

- **Strictness test:** it initially inspected the output form, where zod reports even
  non-strict objects as closed, so loosening `ProfileCard` did not fail it. It now inspects the
  input form, and the same mutation fails 7 tests.
- **Boundary rule:** it now exempts the contracts package's own tool config files
  (`eslint.config.js`, `vitest.config.js`), as it already exempted `test/`.
- **Docker build:** CI run 14 failed because the root `package.json` now lists
  `@vouch/contracts`, but the Dockerfile did not copy that package's `package.json` into the
  build stage. Fixed. The image build, `/health` and graceful stop were re-run locally, and CI
  re-ran.

**Decisions made:**

- [ADR 0007 — Contract versioning, ids exposed to clients, and contract tooling](../adr/0007-contract-versioning.md)
- Owner decisions applied:
  - UUIDv7 ids for matches, conversations, uploads and reports; users only by `public_id`
  - gender codes `0`/`1`/`2`; `interestedIn` is a non-empty set
  - OTP always answers `{ sent: true }`; `SIGNUP_DETAILS_REQUIRED` neither consumes the code nor
    counts as an attempt (documented on the endpoint and in the README)
  - refresh token in the body or a `Secure`, `SameSite=Strict`, `Path=/v1/auth/refresh` cookie
  - the `message.send` ack shape
  - "interests" means `interested_in`
  - message identity is `(conversation_id, seq)`
  - the four proposed retention values are accepted for now

**Deviations from the roadmap:**

- **Extra committed file `packages/contracts/schemas.json`:** it gives the contract diff a
  baseline covering socket events, domain events, jobs and pipelines, not just REST.
- **Generator location:** generation and diff logic live in `packages/contracts/tooling/`
  (pure, zod only); the CLIs are `scripts/contracts-generate.js` and `scripts/contracts-diff.js`.
  The npm script is `contracts:generate` (the roadmap says `contracts:openapi`), because it
  writes both files.
- **Photo ids:** the owner's own photos are exposed by UUIDv7 in `GET /v1/me/profile`; admin-only
  resources use UUIDv7 too. Both are recorded in ADR 0007.
- **Extra admin endpoint:** `GET /v1/admin/users/{userId}` (user lookup, from Phase 10's list).
  Admin login and MFA enrolment routes are left to Phase 10 as additive endpoints.
- **Message history paging:** `GET /v1/conversations/{id}/messages` pages by `afterSeq` and
  returns `nextAfterSeq` instead of an opaque cursor, because messages are addressed by seq.

**Known issues and risks:**

- **`openapi.json` size:** about 300 KB, because zod inlines date-time, email and UUID patterns.
  Hoisting shared schemas into `components` can come later.
- **Union comparison:** the diff compares unions by position, so reordering options reads as
  breaking. This is conservative.
- **No baseline on `main` yet:** this PR is the first with `schemas.json`, so the diff has
  nothing to compare against until it is merged.
- **`env.js`:** `JWT_SIGNING_KEYS` is a JSON string until Phase 5 fixes its shape.
  `MODERATION_PROVIDER` is an open string until Phase 7 chooses a provider.

**Suggested follow-ups (not done, need approval):**

1. Phase 4: a migration giving `vouch_discovery` outbox and inbox grants (your answer 3), and
   reuse of the UUIDv7 helper for `newId`.
2. Phase 10: admin login and MFA endpoints (additive).
3. Later: hoist repeated schemas into OpenAPI `components` to shrink `openapi.json`.

**How you can check it yourself:**

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:boundaries && pnpm test
```

```bash
pnpm contracts:generate && git diff --exit-code packages/contracts
```

```bash
pnpm contracts:diff --base origin/main
```

**CI run:** see the PR checks for the final commit (run 14 on `67fdde0` failed at the Docker
build, fixed as described above).

**Pull request:** opened from `claude/lucid-rubin-foq2uj` into `main`, titled "Phase 3 — API,
event and socket contracts" · Branch: `claude/lucid-rubin-foq2uj` (ADR 0002)

⏸️ I have stopped. Reply "Approved: Phase 3 complete" to close this phase.
I will not start Phase 4 until you approve its start plan.
