# Platform kernel (`apps/api/src/platform`)

The shared backend core. It holds no business rules and imports no module (enforced by
dependency-cruiser). Modules receive these services through the registry context.

| Component     | File                                                          | What it provides                                                                                                                                     |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config        | `config.js`                                                   | `loadConfig()` parses `process.env` with `contracts` `EnvSchema` plus the JWT key format; refuses to boot on errors (names only, never values)       |
| Logger        | `logger.js`, `context.js`                                     | pino with request id, trace id and module from async context; redacts auth headers, tokens, emails and message bodies                                |
| Database      | `db.js`                                                       | One pool; `transaction(module, fn)` / `read(module, fn)` run as `vouch_<module>` via `SET LOCAL ROLE` (ADR 0010)                                     |
| Redis         | `redis.js`                                                    | Command client, Socket.IO pub/sub pair (lazy), BullMQ connection options                                                                             |
| Unit of work  | `uow.js`, `events/outbox.js`                                  | `uow.run(fn)` with `{ tx, stores, emit }`; `emit` validates and writes to the outbox in the same transaction                                         |
| Locks         | `locks.js`                                                    | `lockPair(tx, a, b)`: transaction-level advisory lock for an unordered pair                                                                          |
| Event bus     | `events/relay.js`, `events/consume.js`, `events/retention.js` | Outbox relay, inbox-deduplicated consumers, nightly retention (ADR 0008)                                                                             |
| Jobs          | `jobs.js`                                                     | Queue classes `fast`, `bulk`, `media`, `external` (+ `evt.<module>`); jittered exponential backoff; `dlq.<queue>`; cron schedules run once           |
| Registry      | `registry.js`                                                 | `defineModule()` (zod-validated manifest), dependency sort with cycle detection, role-aware `bootModules()`                                          |
| Pipelines     | `pipelines.js`                                                | Named ordered chains with per-step timeouts; skip-on-failure or fail-closed                                                                          |
| Use cases     | `use-case.js`, `idempotency.js`                               | `useCase()` chain: tracing → metrics → authz → validation → flag → idempotency (ADR 0009)                                                            |
| Errors        | `errors.js`                                                   | `AppError(code)` with contract statuses; Fastify error and not-found handlers; generic 500s                                                          |
| Auth          | `auth.js`                                                     | EdDSA access-token verification with `kid` rotation and a 15-minute grace for retired keys; `vouch:user` / `vouch:admin`; admin MFA and IP allowlist |
| Flags         | `flags.js`                                                    | Rule evaluation (campus, cohort, percentage, platform, min app version, kill switch); Redis cache 30 s; Postgres fallback                            |
| HTTP root     | `http.js`                                                     | helmet, CORS allowlist, cookies, Redis rate limiting, zod type provider, app-version gate, Swagger at `/docs` (non-production)                       |
| Health        | `health.js`                                                   | `/health` and `/ready` (Postgres, Redis, migrations); silent request logs; one log line per readiness change                                         |
| Metrics       | `metrics.js`                                                  | prom-client: process, event loop, HTTP RED, use-case durations; served only on `METRICS_PORT`                                                        |
| Observability | `observability.js`                                            | OpenTelemetry SDK when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; Sentry when `SENTRY_DSN` is set                                                         |
| Ids and time  | `ids.js`, `clock.js`                                          | UUIDv7 `newId` from the injected clock (ADR 0004)                                                                                                    |
| Boot          | `boot.js`, `../main.js`                                       | `createPlatform()`, `startRole()` for `api`, `ws`, `worker` or `all`; graceful drain (`SHUTDOWN_DRAIN_MS`, default 25 s)                             |

## Roles

| Role     | Serves                                                       | Runs                                                           |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `api`    | `/health`, `/ready`, module routes, `/docs` (non-production) | —                                                              |
| `ws`     | `/health`, `/ready` (Socket.IO arrives in Phase 9)           | —                                                              |
| `worker` | `/health`, `/ready`                                          | Event consumers, module jobs, outbox relay, retention schedule |
| `all`    | Everything above (beta)                                      | Everything above                                               |

Every role serves `/metrics` on `METRICS_PORT` (default 9464), never on the public port.

## Adding a module

Run `pnpm new-module <name>`, add it to `src/modules/index.js`, and add its migrations folder to
`migrations/run.js`. See `src/modules/_example` (test only) for a complete, minimal module.
