## Phase 4 — Backend platform kernel: Completion Report

**Summary:** The backend kernel every module builds on is in place and tested against real
Postgres 17 and Redis 7. One process boots as `api`, `ws`, `worker` or `all`. Every module query
runs as that module's own Postgres role through `SET LOCAL ROLE` inside its transaction. The test-only
`_example` module proves the whole path (HTTP → use case → outbox → relay → consumer → inbox),
with one trace id carried through.

**Completion criteria:**

- [x] **Every kernel component in Tasks 1–20 exists, is documented and is tested.** See the
      component list below and `apps/api/src/platform/README.md`.
- [x] **The `_example` module flows end to end:** HTTP → use case → outbox → relay → consumer →
      inbox. Evidence: `test/platform/example-e2e.test.js` (sequence log below).
- [x] **Coverage on `src/platform` is at least 90%:** 99.02% lines. The threshold is enforced
      in `apps/api/vitest.config.js`, so `pnpm test` fails below 90%.
- [x] **The boundary check passes:** `src/platform` imports no module (rule
      `platform-no-modules`).

**Owner items for this phase:**

- [x] **1. `vouch_discovery` grants:** migration `20261121009000_discovery_event_grants.sql`
      gives it the same outbox, inbox, flags and deletion-task grants as other module roles.
      Verified by the role privilege matrix and `db-kernel.test.js`.
- [x] **2. `newId`:** it reuses the seed's UUIDv7 helper, moved to `src/platform/ids.js` with
      its tests. The seed imports it from there; its output is unchanged (the file moved, only
      `createIdGenerator` was added).
- [x] **3. Quieter health logging:** `/health` and `/ready` write no request logs; readiness
      logs once when it fails and once when it recovers. Evidence: `boot.test.js` captures the
      log stream.
- [x] **Decision 1 (roles):** `SET LOCAL ROLE` per transaction, through `uow.run` and
      `db.read`; recorded in ADR 0010. Tested: a module cannot write another module's schema,
      and the role does not leak to the next transaction on the same connection (`max: 1`), even
      after a rollback.
- [x] **Decision 2:** `/metrics` is served only on `METRICS_PORT` (9464); the public port
      returns 404.
- [x] **Decision 3:** the `ws` role serves `/health`, `/ready` and metrics only.
- [x] **Decision 4:** `JWT_SIGNING_KEYS` is a JSON array of
      `{ kid, publicJwk, privateJwk?, retiredAt? }` (Ed25519), with a 15-minute grace window and
      the audiences `vouch:user` and `vouch:admin`.
- [x] **Decision 5:** the health schemas live in `platform/health.js`.
- [x] **Drain:** 25 s by default, configurable with `SHUTDOWN_DRAIN_MS` (1–29 s, so it always
      finishes before the host's 30 s kill).

**Component list** (all in `apps/api/src/platform/`):

| Task | Component                                                       | Files                                                         |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| 1    | Config                                                          | `config.js`                                                   |
| 2    | Logger with redaction and context                               | `logger.js`, `context.js`                                     |
| 3    | Database (`SET LOCAL ROLE`, statement timeout, read-only reads) | `db.js`                                                       |
| 4    | Redis (command, pub/sub pair, BullMQ options)                   | `redis.js`                                                    |
| 5    | Unit of work and outbox `emit`                                  | `uow.js`, `events/outbox.js`                                  |
| 6    | Advisory pair lock                                              | `locks.js`                                                    |
| 7    | Event bus: relay, consumer, retention                           | `events/relay.js`, `events/consume.js`, `events/retention.js` |
| 8    | Jobs: queue classes, jittered backoff, DLQ, cron                | `jobs.js`                                                     |
| 9    | Module registry                                                 | `registry.js`                                                 |
| 10   | Pipelines                                                       | `pipelines.js`                                                |
| 11   | Use-case pipeline and idempotency                               | `use-case.js`, `idempotency.js`                               |
| 12   | Errors                                                          | `errors.js`                                                   |
| 13   | Auth verification                                               | `auth.js`                                                     |
| 14   | Feature flags                                                   | `flags.js`                                                    |
| 15   | HTTP root                                                       | `http.js`                                                     |
| 16   | Health and readiness                                            | `health.js`                                                   |
| 17   | Boot and graceful shutdown                                      | `boot.js`, `../main.js`                                       |
| 18   | Observability (metrics, OpenTelemetry, Sentry)                  | `metrics.js`, `observability.js`                              |
| 19   | Example module (test only)                                      | `../modules/_example/**`                                      |
| 20   | Generator                                                       | `/scripts/new-module.js` (`pnpm new-module <name>`)           |
| —    | Ids and clock                                                   | `ids.js`, `clock.js`                                          |

**Tests and validation** (clean clone; Node v24.22.3, pnpm 10.34.9, Docker 29.10.0):

```
pnpm lint                 → exit 0 (4 tasks, --max-warnings 0)
pnpm format:check         → All matched files use Prettier code style!
pnpm typecheck            → exit 0
pnpm check:boundaries     → ✔ no dependency violations found
pnpm contracts:check      → Generated contracts are up to date.
pnpm contracts:diff       → No breaking contract changes against origin/main.
pnpm test                 → 31 s
  @vouch/contracts  Test Files 5 passed  · Tests 349 passed
  @vouch/config     Test Files 2 passed  · Tests 4 passed
  @vouch/api        Test Files 23 passed · Tests 153 passed
```

The full API suite also ran three more times in a row, with 153 passing each time.

Coverage (`src/platform`, v8):

```
Statements   : 97.76% ( 700/716 )
Branches     : 90.6%  ( 347/383 )
Functions    : 97.16% ( 206/212 )
Lines        : 99.02% ( 609/615 )
```

What the integration tests cover (Testcontainers, a non-superuser login that is a member of
every module role):

- **Unit of work:** an event emitted in a rolled-back transaction leaves no outbox row; a
  committed emit carries the trace id; payloads are checked against their contract.
- **Relay:** it fans out to two consumers, each running its handler once.
- **Redelivery:** a redelivered event runs its handler once; a handler failure rolls back its
  inbox row, so a retry processes it.
- **Dead letters:** a failing consumer dead-letters (`dlq.evt.chat`) without blocking the other
  consumer.
- **Concurrency:** three relays running concurrently over 50 events publish exactly 50.
- **Idempotency:**
  - the same key twice returns the stored result and runs the handler once
  - a different input with the same key gets `IDEMPOTENCY_KEY_REUSED`
  - a duplicate while the first call is in flight gets `CONFLICT`
  - a failure releases the key
- **Boot:**
  - every role boots in process and as a real `main.js`; SIGTERM drains with exit code 0
  - `/ready` returns 503 while Redis is paused, and recovers
  - pending migrations show as `migrations: fail`
  - an invalid environment is refused without printing secrets, including the Phase 1
    invalid-`PORT` check

Three mutation checks confirmed the key tests can fail. Each change was reverted afterwards:

| Mutation                                                     | Result                       |
| ------------------------------------------------------------ | ---------------------------- |
| `/health` and `/ready` logging at `info` instead of `silent` | quiet-logging test fails     |
| Relay without `FOR UPDATE SKIP LOCKED`                       | concurrent-relays test fails |
| No `SET LOCAL ROLE` in the database preamble                 | 5 database-kernel tests fail |
| Retired-key grace check removed                              | retired-key test fails       |

End-to-end sequence (`example-e2e.test.js`, one trace id through every hop):

```
1. HTTP POST /example/notes    requestId=req-e2e-1 → 201 noteId=01a2006f-75ea-79b8-8656-89260a1c31be
2. use case → outbox row       id=1 name=example.note_created.v1 trace_id=req-e2e-1
3. relay → evt.example         jobId=example-1 published_at set
4. consumer → handler          traceId=req-e2e-1 eventId=1
5. inbox                       (example, 1)
```

Relay latency (event written → consumer ran), measured locally:

| Situation                        | Latency                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| 20 sequential events, relay busy | p50 183 ms, p95 185 ms, max 185 ms                           |
| First event after an idle period | 2,057 ms (the relay polls every 2 s when idle, as specified) |

Boot logs per role (`node --env-file=.env src/main.js`, Docker Compose; timestamps removed):

```
ROLE=api     "Server listening at http://127.0.0.1:3000" · "started" · SIGTERM → "shutting down" drainMs=25000 · "shutdown complete"
ROLE=ws      "Server listening at http://127.0.0.1:3000" · "started" · SIGTERM → "shutting down" drainMs=25000 · "shutdown complete"
ROLE=worker  "Server listening at http://127.0.0.1:3000" · "started" · SIGTERM → "shutting down" drainMs=25000 · "shutdown complete"
ROLE=all     "Server listening at http://127.0.0.1:3000" · "started" · SIGTERM → "shutting down" drainMs=25000 · "shutdown complete"
```

Docker, using the same steps as the CI job:

```
node migrations/run.js up (from the image)   → up: 11 migration(s) ran
GET /health                                  → {"status":"ok"}
GET /ready                                   → {"status":"ready","checks":{"postgres":"ok","redis":"ok","migrations":"ok"}}
GET :9464/metrics                            → process_cpu_user_seconds_total present
GET :3000/metrics                            → 404
docker stop --time 30                        → exit code 0 (about 85 ms)
```

**Decisions made:**

- [ADR 0008 — Event bus](../adr/0008-event-bus.md)
- [ADR 0009 — Use-case pipeline](../adr/0009-use-case-pipeline.md)
- [ADR 0010 — Database roles per transaction](../adr/0010-database-roles-per-transaction.md)

**Deviations from the roadmap:**

- **Job ids:** BullMQ rejects `:` in custom ids (`Custom Id cannot contain :`, verified), so
  relay job ids are `<consumer>-<outboxId>`, not `<consumer>:<outboxId>`.
- **Relay routing:** it uses the full event name (`user.created.v1`). ARCHITECTURE 8.2's
  `${name}.v${version}` would double the version.
- **Outbox column grant:** module roles also hold a column-level `SELECT (id)` on
  `platform.outbox`, because `INSERT … RETURNING id` needs it; payloads stay unreadable (tested).
  `vouch_platform` can read `public.pgmigrations` for `/ready`. Both are in the Phase 4
  migration.
- **ADR 0003's discovery consequence is superseded:** it said discovery events would go through
  `vouch_platform`; your answer 3 gives `vouch_discovery` its own grants instead. ADR 0003 is
  unchanged (accepted ADRs are not edited), and ADR 0008 and this report record it.
- **Phase 1 tests replaced:** `src/app.js` gave way to the kernel HTTP root, and
  `test/health.test.js` and `test/main.test.js` were replaced by `test/platform/boot.test.js`.
  Every Phase 1 check is still covered: serving `/health`, SIGTERM exit 0, and invalid `PORT`.
- **Example module layout:** the module is named `example` (folder `_example`). Its event and
  input schema live in its own `contract.js`, so its application layer imports only what B.4
  allows.
- **Retention tick:** a scheduled job named `platform.retentionTick` (03:17 UTC) enqueues
  `platform.retention` with a computed cutoff. The tick name is internal, so it is not in the
  contracts.
- **Contracts env (additive):** `METRICS_PORT` and `SHUTDOWN_DRAIN_MS`. The contract diff
  passes.
- **`.env.example`:** it lists every required variable, with a public-only development JWT key;
  Phase 5 adds signing keys.

**Known issues and risks:**

- **Image size:** the image grew from 261 MB to 483 MB, mostly from the OpenTelemetry and
  Sentry SDKs.
- **ESM auto-instrumentation:** full OpenTelemetry auto-instrumentation of ESM libraries needs
  `node --import @opentelemetry/auto-instrumentations-node/register`. The deploy configuration
  (Phase 15) should set it; manual use-case spans work without it.
- **Idle relay latency:** up to about 2 s for the first event after a quiet period. Shortening
  the idle interval costs more queries.
- **Rate limiter fails open:** with `skipOnError`, the limiter stops enforcing while Redis is
  down instead of blocking all traffic.
- **Read cost:** every read runs in a short transaction (one extra round trip), per ADR 0010.
- **Docker in this container:** the daemon here has to be kept running as a background task. CI
  is unaffected.

**Suggested follow-ups (not done, need approval):**

1. Phase 5: a script that generates local Ed25519 signing keys for `.env`.
2. Phase 15: start Node with the OpenTelemetry `--import` hook, and set the host's stop timeout
   to 30 s.
3. Later: trim the image (for example, load Sentry only when a DSN is set at build time).

**How you can check it yourself:**

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:boundaries && pnpm test
```

```bash
cp .env.example .env && docker compose up -d --wait && pnpm db:migrate
```

```bash
cd apps/api && node --env-file=../../.env src/main.js
```

Then check `curl localhost:3000/ready` and `curl localhost:9464/metrics`. To try another role,
start the server with `ROLE=worker` (or `ws`) in front of the command above.

**CI run:** https://github.com/Tejas-lab-source/vouch/actions/runs/44962871832 (both jobs green on `05f23c1`, the last code commit).

**Pull request:** opened from `claude/lucid-rubin-foq2uj` into `main`, titled "Phase 4 —
Backend platform kernel" · Branch: `claude/lucid-rubin-foq2uj` (ADR 0002)

⏸️ I have stopped. Reply "Approved: Phase 4 complete" to close this phase.
I will not start Phase 5 until you approve its start plan.
