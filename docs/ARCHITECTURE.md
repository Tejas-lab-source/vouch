# Vouch — Extensible Architecture & Build Plan (v2)

> Reference design for Vouch, dated 2026-11-21. For **what to build and in which order**, `docs/ROADMAP.md` (15 phases) overrides sections 13–14 of this document. Use this file for design detail: schema, flows, contracts, extension points.

## 1. Summary

Vouch v2 keeps the v1 product and the exact v1 stack, but rebuilds the inside as a **modular monolith of hexagonal modules plugged into a fixed set of extension points**. A new feature becomes a new module or a new slice that registers itself. It never needs edits scattered across the codebase.

The target is the same as v1: launch on 1-2 campuses (2k-20k users), and design for 1M registered users and 300k daily active users (DAU). Section 3 recomputes every number with a peak-hour model. Section 13 is new: the exact order in which to design and code each layer.

### Architecture at a glance

- **Shape:** one JavaScript codebase (Node.js 24 LTS, ES modules, Fastify 5) that runs as `ROLE=api | ws | worker | all`. One Docker image serves all three roles.
- **Inside each module:** domain (pure rules) → application (use cases) → ports (interfaces) → adapters (HTTP, socket, jobs, SQL, Redis, R2, push). Dependencies point inward only.
- **Between modules:** a published module API for questions that need an answer now, and versioned domain events (outbox → relay → per-consumer queues → inbox) for facts.
- **Extension model:** every module declares a manifest (routes, socket handlers, jobs, event subscriptions, pipeline contributions, flags, admin panels). A registry loads the manifests in dependency order.
- **Data:** PostgreSQL is the only source of truth, with one Postgres schema per module. Redis holds disposable state (decks, caches, queues, pub/sub). Photos live in Cloudflare R2 behind the Cloudflare CDN.
- **Frontend:** Turborepo monorepo. Web and admin use React + Vite, mobile uses Expo. All three are organised by Feature-Sliced Design, with UI slots that new features fill.
- **Cost:** a closed beta runs at about $25-40 a month (section 3.5).
- **Plan:** 100 days, with gates at days 50, 72 and 85, and a closed beta from day 94 (sections 13-14).

### What changed from v1

| Area | v1 | v2 | Why |
| --- | --- | --- | --- |
| Module internals | routes → service → repository | domain → use cases → ports → adapters | Business rules testable without Fastify or Postgres; any adapter is swappable |
| Wiring | Hand-edited `src/app.js` | Module manifests + registry, loaded per role | Adding a module is one line in the module list |
| Cross-module side effects | Outbox → one events queue | Outbox → relay → one queue per consumer → inbox dedupe | A slow consumer never blocks others; exactly-once effects |
| Extensibility | Implicit | 12 named extension points (section 6) | New features plug in instead of patching |
| Data ownership | Tables per module, by convention | One Postgres schema per module, with grants and published views | Boundaries enforced by the database too |
| Use-case pipeline | Ad hoc per route | Composable decorators: tracing, auth, validation, idempotency, transaction | A new cross-cutting layer is one decorator |
| Frontend | Shared hooks | Feature-Sliced Design + feature registry + UI slots | Front-end features plug in the same way |
| Capacity math | 5x average peak | Peak-hour model, Little's law, per-stage tables | Numbers drive decisions (section 3) |
| Build order | Implicit in roadmap | Explicit design-first and code-first order (section 13) | Avoids rework |
| Privacy | DPDP noted | DPDP Rules 2025 phases mapped to features | Main obligations start May 2027 |

Versions as of November 2026: Node.js 24 is still LTS, and Node.js 26 became LTS in October 2026. PostgreSQL 18 adds a native `uuidv7()`. The plan keeps the v1 versions and lists these as drop-in upgrades (section 4).

## 2. Product, scope and design principles

Vouch is a dating app and website only for verified college students. It launches on one or two campuses and widens to nearby colleges in the same city. The product is unchanged from v1. What is new is that every "later" feature already has a named place to plug in.

### 2.1 User journey (v1)

1. Verify a college email with a one-time code, or use the reviewed ID-card fallback.
2. Build a profile with at least 2 photos, a date of birth (18+ only) and preferences.
3. Swipe through a deck of students from your campus cluster.
4. A mutual like creates a match and opens a conversation.
5. Chat in real time, with a push notification when the other person is offline.
6. Block, report or unmatch at any time.

### 2.2 Scope, and where each later feature plugs in

| Feature | When | Plugs into (section 6) |
| --- | --- | --- |
| Verify, profile, swipe, match, chat | v1 | Core modules |
| Block, report, photo moderation, admin queue | v1 | `safety` module, `ModerationProvider` port, admin panels |
| Profile prompts and icebreakers | Later | New `prompts` module; profile-section registry; chat composer slot |
| Stories | Later | New `stories` module; reuses the media pipeline and `StorageProvider` port |
| Selfie liveness check | Later | New adapter behind the `VerificationProvider` port |
| Premium tier and boosts | Later | New `billing` module; `Entitlements` port; discovery scorer pipeline |
| Learned ranking | Later | New adapter behind the `Ranker` port, fed by impression events |
| Campus events and groups | Later | New `events` module; new socket room type; new home tab slot |
| Ambassadors and referrals | Later | New `growth` module subscribed to `user.created.v1` |
| More cities | Later | Data only: new rows in `colleges` and `campus_clusters` |

### 2.3 How we know it works

Track these per campus: day-1 and day-7 retention, time to first match, match rate, message reply rate, and the share of sessions that end with an empty deck.

### 2.4 Design principles

The first five principles exist so features can be added without rework. The rest keep the system correct under load.

1. **Extend by adding, not editing.** A new feature is a new module, slice, adapter or pipeline step. If adding a feature means editing another module's internals, the extension point is missing. Add the extension point first.
2. **Dependencies point inward.** Domain code imports nothing from Fastify, postgres.js, ioredis or the AWS SDK. Adapters depend on ports, never the reverse.
3. **Contracts first.** Every boundary is a zod schema in `packages/contracts` before any code exists. That covers HTTP, socket events, domain events, jobs and env vars.
4. **Questions are calls, facts are events.** If module A needs an answer now, it calls module B's public API. If A announces that something happened, it emits a versioned event.
5. **Change contracts additively.** Add fields and never remove them in place. A breaking change ships as `v2` beside `v1` (expand, migrate, contract).
6. **Postgres is the source of truth; Redis is disposable.** If Redis is wiped, decks rebuild and lost jobs replay from the outbox.
7. **Each module owns its data.** One Postgres schema per module. Other modules read only its published views or its API.
8. **Stateless runtime.** JWT sessions and no in-memory user state, so any process can serve any request.
9. **Every write is idempotent.** Mobile networks retry, so every write carries a client id or an idempotency key.
10. **Strong for trust, eventual for convenience.** Matches, blocks and reports are strongly consistent. Feeds, counters and presence are eventually consistent.
11. **Every new feature ships behind a flag.** Each flag has a kill switch and a rollout rule by campus, cohort or percentage.
12. **Scope by campus.** Nearly every query carries `college_id` or `cluster_id`, which is Vouch's natural partition key.
13. **Design for failure.** Timeouts, retries with backoff and jitter, dead-letter queues and graceful shutdown on every process.

## 3. Capacity math

At launch size (20k users) the system peaks at about 47 API requests a second, which one small instance handles easily. The binding limits in beta are free-tier quotas, not CPU. At the 1M-user design target, the hard numbers are 625 swipes a second, 30k sockets and about 2.3 GB of new rows a day. Those numbers decide partitioning, gateway count and pooling.

### 3.1 Assumptions

Every figure below is an assumption until beta data replaces it. When the beta produces real numbers, update this table and rerun the math.

| Input | Value | Note |
| --- | --- | --- |
| DAU / registered | 30% | Dating apps in a tight campus cluster |
| Swipes per DAU per day | 40 | 4 deck pages of 10 |
| Right-swipe share | 30% | Likes as a share of all swipes |
| Likes that become mutual | 5% | Gives matches per day |
| Messages per DAU per day | 10 |  |
| API requests per DAU per day | 150 | Swipes, deck pages, hydration, chat history, config |
| Peak window | 25% of daily activity in 2 evening hours | 8-10 pm IST |
| Burst inside the peak | 1.5x | Minute-level spikes |
| Concurrent sockets | 10% of DAU |  |
| Mean API service time | 50 ms | Used for Little's law |
| Row sizes, including indexes | swipe 130 B, message 250 B | Postgres tuple header plus B-tree entries |
| Photo variants | 6 photos x (1080 px + 400 px WebP) = 165 KB each | Raw uploads deleted after processing |
| Pass retention | 30 days | Then the person can reappear |

### 3.2 Formulas

Peak rate for any daily volume:

```latex
\lambda_{peak} = \frac{V_{day} \times 0.25}{7200\,s} \times 1.5
```

Requests in flight at peak (Little's law), which sizes connection pools and worker concurrency:

```latex
L = \lambda_{peak} \times W
```

Steady-state storage for data kept N days:

```latex
S = V_{day} \times \text{row bytes} \times N
```

### 3.3 Results by stage

Computed with a script from the assumptions above.

| Metric | Beta small | Beta large | Growth | Design target |
| --- | --- | --- | --- | --- |
| Registered users | 2,000 | 20,000 | 200,000 | 1,000,000 |
| DAU | 600 | 6,000 | 60,000 | 300,000 |
| Swipes per day | 24k | 240k | 2.4M | 12M |
| Swipes/s at peak | 1.3 | 12.5 | 125 | 625 |
| Match transactions/s at peak (likes) | 0.4 | 3.8 | 38 | 188 |
| Matches per day | 360 | 3,600 | 36k | 180k |
| Messages/s at peak | 0.3 | 3.1 | 31 | 156 |
| API requests/s at peak | 4.7 | 47 | 469 | 2,344 |
| API requests in flight at peak | 0.2 | 2.3 | 23 | 117 |
| Concurrent sockets | 60 | 600 | 6,000 | 30,000 |
| Passes kept (30 days) | 0.07 GB | 0.66 GB | 6.6 GB | 33 GB |
| Likes, per year | 0.34 GB | 3.4 GB | 34 GB | 171 GB |
| Messages, per year | 0.55 GB | 5.5 GB | 55 GB | 274 GB |
| Photos | 2 GB | 20 GB | 198 GB | 990 GB |
| Redis hot set (deck, served set, profile cache) | 4 MB | 36 MB | 360 MB | 1.8 GB |
| Push notifications/s at peak | 0.2 | 1.6 | 16 | 80 |

### 3.4 What the numbers decide

- **API processes.** Plan on 500 requests/s per Fastify process at 60% CPU; load tests confirm it on day 85. Beta needs 1 process (`ROLE=all`), growth needs 2 plus 1 spare, and the design target needs 5 plus 1 spare.
- **Postgres writes.** 188 match transactions/s plus 156 message inserts/s plus batched passes fits one tuned primary (8 vCPU). Table size is the problem, not throughput: about 2.3 GB of new rows a day at design.
- **Partitioning.** Swipes hash-partitioned 16 ways on `swiper_id`, and messages 16 ways on `conversation_id`, from the Growth stage. Both primary keys already contain the partition key, which Postgres requires ([source](https://www.pgedge.com/blog/enforcing-constraints-across-postgres-partitions)).
- **Pass retention.** 30 days instead of v1's 90 cuts the design-stage pass table from about 98 GB to 33 GB.
- **Sockets.** 30k sockets at 6k per gateway = 5 gateway processes. At about 30 KB per socket that is 0.9 GB in total, and 1,200 heartbeats a second at a 25-second ping interval.
- **Database connections.** 16 processes (6 API, 6 gateway, 4 worker) x pool 10 = 160 client connections. PgBouncer funnels them into about 40 server connections.
- **Push.** 80/s at peak is well under Expo's limit of 600 notifications a second per project ([source](https://docs.expo.dev/push-notifications/faq/)). Send in chunks of 100.
- **Redis.** The hot set stays under 2 GB at design, so one 4 GB node with a replica is enough.

### 3.5 Free-tier cliffs and the beta budget

Three free tiers break early and one fits, and the math shows when:

- **Neon storage.** The free plan has 1 GB per project, and writes that grow storage fail at the cap ([source](https://neon.com/faqs/free-plan-limits-and-quotas)). At 20k users the database passes 1 GB in about 3 weeks. At 2k users it lasts about a year.
- **Neon compute.** The free plan has 100 CU-hours per project, which is 400 hours at 0.25 CU, or about 13 hours a day. The outbox relay polls every 2 s, so the database never scales to zero. Always-on 0.25 CU uses 182.5 CU-hours, about $19 a month at the Launch rate of $0.106 per CU-hour ([source](https://neon.com/docs/introduction/limits)).
- **Upstash Redis.** The free tier has 500K commands a month ([source](https://upstash.com/docs/redis/overall/billing)). A 20k-user beta issues about 2.7M commands a day, so use Upstash only in development.
- **R2.** The free tier has 10 GB storage, 1M Class A and 10M Class B operations a month ([source](https://developers.cloudflare.com/r2/pricing)). Photo onboarding for 20k users is about 360k Class A writes, which fits, and storage beyond 10 GB costs $0.015 per GB-month.

| Beta item | Choice | Monthly |
| --- | --- | --- |
| App (API + gateway + worker in one process) | Render Starter, always on | $7 ([source](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses)) |
| Postgres | Render Basic-256mb, or Neon Launch at 0.25 CU always on | about $6-19 |
| Redis | Render Key Value paid tier, persistence off | about $10 (unverified) |
| Photos and CDN | Cloudflare R2 + CDN | $0-1 |
| Email OTP | Resend or Brevo free tier | $0 (limits unverified) |
| Push | Expo push service | $0 |
| Errors and traces | Sentry free tier | $0 |
| **Total** |  | **about $25-40** |

Do not run the beta on free Render web services: they spin down after 15 minutes idle and take about a minute to wake ([source](https://render.com/docs/free)). Background workers have no free tier there either.

## 4. Technology stack

The stack is exactly v1's. What v2 adds is the layer each tool lives in. Every infrastructure library sits in an adapter behind a port, so swapping or adding one never touches business rules.

### 4.1 Backend

| Concern | Choice | Layer it lives in | Status (Nov 2026) and notes |
| --- | --- | --- | --- |
| Runtime | Node.js 24 LTS, ES modules, no build step | Process | Still LTS; Node.js 26 became LTS in October 2026 and is the next upgrade ([source](https://nodejs.org/about/releases/)) |
| HTTP framework | Fastify 5 | Inbound HTTP adapter | Plugins give each module its own encapsulated context ([source](https://fastify.dev/docs/v5.3.x/Reference/Encapsulation.md)) |
| Validation and contracts | zod + `fastify-type-provider-zod`, OpenAPI via `@fastify/swagger` | `packages/contracts` | One schema validates at runtime and generates the OpenAPI spec |
| Database driver | postgres.js (tagged-template SQL) | Outbound SQL adapters | Hand-written SQL; no ORM on hot paths |
| Migrations | node-pg-migrate, plain SQL files, one folder per module | Module `migrations/` | Expand-then-contract friendly |
| Database | PostgreSQL 17 | Source of truth | PostgreSQL 18 is a drop-in upgrade that adds native `uuidv7()` ([source](https://postgresql.org/about/news/postgresql-18-released-3142/)) |
| Pooling | PgBouncer in transaction mode, or the host's pooled URL | Platform | PgBouncer 1.21+ supports prepared statements in transaction mode, and 1.24 turns it on by default ([source](https://www.prisma.io/postgres/prepared-statement-already-exists)) |
| Cache, pub/sub, queues | Redis 7 (or Valkey) via ioredis | Outbound adapters | Disposable by design |
| Jobs and events | BullMQ | Platform job runner + module job adapters | Retries, backoff, dead-letter, job-id dedupe |
| Realtime | Socket.IO + `@socket.io/redis-adapter`, WebSocket transport only | Inbound socket adapter (`ROLE=ws`) | This adapter does not do connection state recovery, so Vouch replays by sequence number itself ([source](https://socket.io/docs/v4/redis-adapter/)) |
| Auth | College-email OTP, `jose` for JWT, rotating refresh tokens | `identity` module | Passwordless; the college email is the trust layer |
| Security plugins | `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`, `@fastify/rate-limit` (Redis store) | Platform HTTP plugins | Applied once at the root context |
| Images | sharp in a worker | `media` outbound adapter | Resize, WebP, EXIF stripping |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` + presigner | `StorageProvider` adapter | S3-compatible, no egress fees |
| Logging | pino | Platform | JSON logs, request ids, PII redaction |
| Config | zod-validated `src/platform/config.js`, `node --env-file` locally | Platform | Refuses to boot on a bad variable |
| Observability | Sentry, OpenTelemetry auto-instrumentation, prom-client, Grafana | Platform | Traces cross the outbox via a stored trace id |
| Testing | Vitest, `fastify.inject`, Testcontainers, k6 | All layers | Section 14.4 |
| Lint | ESLint 9 flat config, Prettier, `eslint-plugin-n`, `eslint-plugin-security`, `// @ts-check` + JSDoc | CI | Plus dependency-cruiser for layer rules |

### 4.2 Clients and platform

| Concern | Choice | Notes |
| --- | --- | --- |
| Monorepo | Turborepo + pnpm workspaces | Shared JS packages need no compile step |
| Mobile | React Native with Expo (JavaScript) | Current SDKs run only on the New Architecture ([source](https://docs.expo.dev/guides/new-architecture)); pin one SDK per release and upgrade between betas |
| Web | React + Vite single-page app (JSX) | Static, free to host |
| Admin | React + Vite app in the same repo | Moderation queue, reports, audit log |
| Web data layer | TanStack Query, React Router, socket.io-client | Same hooks pattern on mobile |
| Landing page | Plain static HTML | Real HTML for search engines and link previews |
| Edge | Cloudflare DNS, CDN, WAF, Turnstile | Free tier |
| Push | Expo push service, later FCM/APNs directly | Behind the `PushProvider` port |
| Email | Resend or Brevo | Behind the `EmailProvider` port |
| Moderation | Image moderation API + admin review queue | Behind the `ModerationProvider` port |
| CI/CD | GitHub Actions + Docker | One image for all roles |
| Beta hosting | Render (app, Postgres or Neon, Key Value) + Cloudflare (R2, web) | Section 3.5 |

### 4.3 Deliberately left out of v1

| Technology | Why not yet | Adopt when |
| --- | --- | --- |
| TypeScript | Your choice: JS with zod at boundaries and JSDoc | A larger team wants compiler checks; migrate one `.js` file at a time |
| Microservices | One developer; every network hop adds failure modes | A module needs different scaling or ownership; the port makes extraction mechanical |
| Kubernetes | Operations cost outweighs the benefit | Several always-on services need autoscaling |
| Kafka | Outbox + BullMQ covers v1 | You need event replay or many independent consumers |
| Elasticsearch or OpenSearch | Per-campus pools fit Postgres + Redis | Filters or ranking outgrow SQL |
| GraphQL | Little benefit in v1 | Clients need very different data shapes |
| An ORM | Match and deck queries need hand-written SQL | Never on hot paths |
| Next.js | The app is behind a login and the API is separate | Public pages must rank in search |

## 5. Layered architecture

Vouch is one deployable codebase split two ways. Vertically, it splits into business modules that each own their data. Inside each module, it splits into four layers whose dependencies point inward. This pairing (a modular monolith whose modules use ports and adapters) is the common pattern for large monoliths that stay changeable ([source](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/hexagonal_monolith)).

### 5.1 System topology

- Clients (web, mobile, admin) reach only the Cloudflare edge: DNS, CDN, WAF and Turnstile.
- Behind the edge, one Docker image runs in three roles. The `api` role serves REST, the `ws` role holds sockets, and the `worker` role runs jobs, the outbox relay and event consumers. In beta one process runs `ROLE=all`.
- PostgreSQL holds every fact. Redis holds decks, caches, rate limits, queues and socket fan-out. R2 holds photos.
- Photo bytes go from the client straight to R2 by presigned URL, never through Node.
- Only gateways and workers call third parties (email, push, moderation).

```
Web (React+Vite) · Mobile (Expo) · Admin (React+Vite, MFA)
              │ HTTPS + WSS
     Cloudflare edge: DNS, CDN, WAF, Turnstile
              │
 One Docker image, ROLE = api | ws | worker | all
   api: REST /v1, use cases    ws: Socket.IO gateway    worker: BullMQ jobs, outbox relay, consumers
              │
 PostgreSQL (source of truth, schema per module) · Redis (decks, cache, queues, pub/sub)
 Cloudflare R2 (photos, presigned uploads) · Third parties (email, push, moderation)
```

Every request enters through Cloudflare; the three roles share one image and one source of truth.

### 5.2 Inside a module: four layers

| Layer | Holds | Knows about | Example in `matching` |
| --- | --- | --- | --- |
| Domain | Pure rules, value objects, invariants, event constructors | Nothing outside the module | `canonicalPair()`, `decideMatch()` |
| Application | Use cases (commands and queries) that orchestrate domain + ports | Domain, ports, contracts, the unit of work | `like()`, `unmatch()`, `listMatches()` |
| Ports | JSDoc typedefs of what the module needs from outside | Domain types only | `SwipeStore`, `MatchStore`, `BlockPolicy` |
| Adapters | Inbound (HTTP, socket, job, event handlers) and outbound (SQL, Redis, R2, push) implementations | Everything above + libraries | `routes.js`, `pg/swipe-store.js` |

```
Adapters (in: HTTP, socket, jobs, events | out: SQL, Redis, R2, push, email)
  └─ Ports (JSDoc typedefs: SwipeStore, MatchStore, BlockPolicy)
       └─ Application (use cases: like(), unmatch(), listMatches())
            └─ Domain (pure rules: canonicalPair(), decideMatch(); no I/O)
Dependencies point inward only.
```

The domain sits at the centre and imports nothing; each outer ring may use the rings inside it.

The module's public surface is two files: `manifest.js` (what it adds to the system) and `api.js` (what other modules may call). Everything else is private.

```
src/modules/matching/
  manifest.js              # declares routes, handlers, jobs, subscriptions, flags
  api.js                   # public in-process API for other modules
  ports.js                 # JSDoc typedefs: SwipeStore, MatchStore, BlockPolicy
  domain/
    match.js               # pure rules, no I/O
    match.test.js
  application/
    like.js                # use case
    unmatch.js
    list-matches.js        # query
    like.test.js           # runs against in-memory fakes of the ports
  adapters/
    http/routes.js         # Fastify routes -> use cases
    socket/handlers.js
    jobs/write-passes.js   # BullMQ processor
    events/on-user-blocked.js
    pg/swipe-store.js      # postgres.js implementation of SwipeStore
    pg/match-store.js
  migrations/
    0001_matching_schema.sql
```

### 5.3 The layers in code

Domain code is plain functions with no imports from infrastructure:

```js
// src/modules/matching/domain/match.js
export function canonicalPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function decideMatch({ reverseLike, blocked }) {
  if (blocked) return { matched: false, reason: 'BLOCKED' };
  return reverseLike ? { matched: true } : { matched: false, reason: 'NO_REVERSE_LIKE' };
}
```

A use case receives its ports as arguments and runs inside a unit of work. `emit()` writes to the outbox in the same transaction:

```js
// src/modules/matching/application/like.js
// @ts-check
import { canonicalPair, decideMatch } from '../domain/match.js';
import { MatchCreatedV1 } from '@vouch/contracts/events/matching.js';

/** @param {import('../ports.js').LikeDeps} deps */
export const makeLike = ({ uow, blockPolicy, newId }) => async ({ me, target }) =>
  uow.run(async ({ stores, emit, tx }) => {
    await stores.swipes.recordLike(me, target);
    const [low, high] = canonicalPair(me, target);
    await stores.pairs.lock(low, high); // pg_advisory_xact_lock per pair
    const decision = decideMatch({
      reverseLike: await stores.swipes.hasLiked(target, me),
      blocked: await blockPolicy.isBlocked(me, target, { tx }),
    });
    if (!decision.matched) return { matched: false };
    const { id, created } = await stores.matches.createOrGet(newId(), low, high);
    if (created) emit(MatchCreatedV1, { matchId: id, users: [low, high] });
    return { matched: true, matchId: id };
  });
```

The use case knows nothing about HTTP, SQL or which database it runs on. Its unit test passes in-memory fakes of `stores` and `blockPolicy` and runs in milliseconds.

### 5.4 The use-case pipeline: where new backend layers go

Every use case is wrapped in the same chain of decorators. A new cross-cutting layer (audit, caching, quotas, metering) is one more decorator, added once and applied everywhere:

```js
// src/platform/use-case.js
export function useCase(name, handler, opts = {}) {
  return compose(
    withTracing(name),          // OpenTelemetry span + correlation id
    withMetrics(name),          // duration histogram, error counter
    withAuthz(opts.authz),      // who may call it
    withValidation(opts.input), // zod parse of the input
    withFlag(opts.flag),        // feature flag gate, if any
    withIdempotency(opts.idempotent), // replay the stored result for a repeated key
  )(handler);
}
```

The same chain wraps HTTP routes, socket handlers and job processors. The adapter is thin: parse the transport, call the use case, map the result.

### 5.5 Dependency rules

| Code in | May import | Must never import |
| --- | --- | --- |
| `domain/` | Its own domain files, `packages/domain` | Anything with I/O, any other module |
| `application/` | Own domain and ports, `packages/contracts`, `platform/uow` | Adapters, Fastify, postgres.js, ioredis |
| `adapters/` | Own application, contracts, platform, libraries | Another module's internals |
| `api.js` | Own application | Adapters |
| `src/platform/` | Libraries, contracts | Any module |
| `packages/contracts` | zod | Anything else |

Another module is reached only through dependency injection of its `api.js`, which the registry wires in (section 6.2). CI enforces these rules with dependency-cruiser, so a violation fails the build:

```js
// .dependency-cruiser.cjs (excerpt)
module.exports = { forbidden: [
  { name: 'domain-is-pure', from: { path: 'modules/[^/]+/domain' },
    to: { pathNot: ['modules/[^/]+/domain', 'packages/domain'] } },
  { name: 'no-module-internals', from: { path: 'modules/([^/]+)/' },
    to: { path: 'modules/(?!$1)[^/]+/(?!api\\.js|manifest\\.js)' } },
  { name: 'platform-knows-no-module', from: { path: 'src/platform' }, to: { path: 'src/modules' } },
] };
```

### 5.6 The platform kernel

The platform is the only shared code, and it holds no business rules. It provides config, logger, Postgres and Redis clients, the unit of work, the outbox relay and inbox, the event bus, the job runner, the module registry, feature flags, auth verification, the error model, rate limiting, ids, a clock and the use-case pipeline. Build it before any feature (section 13).

### 5.7 Trust boundaries

- **Internet to edge:** Cloudflare and the load balancer are the only public entry points.
- **App tier:** reachable only through the load balancer. Workers are never exposed.
- **Data plane:** Postgres and Redis accept connections only from the app tier, over TLS. Each module's Postgres role can write only its own schema.
- **Admin console:** separate login with an admin audience claim, MFA and an optional IP allowlist.
- **Third parties:** called outbound only, from gateways and workers, each behind a port with a timeout and a circuit breaker.

## 6. Extension points

Every future feature plugs into one of 12 extension points, declared in a module manifest and loaded by one registry. This is the part of the design that makes Vouch extensible: adding is cheap because the sockets already exist.

### 6.1 Module catalog

The ten v1 modules are the same as in v1. Each owns a Postgres schema of the same name.

| Module | Owns | Public API (`api.js`) | Emits | Consumes |
| --- | --- | --- | --- | --- |
| `identity` | users, auth sessions, devices | `getUser`, `assertActive` | `user.created.v1`, `user.deleted.v1` | none |
| `profiles` | profiles, photos metadata, profile sections | `getCard`, `getCards` | `profile.updated.v1` | `photo.approved.v1`, `user.deleted.v1` |
| `media` | upload records | `presignUpload`, `confirmUpload` | `photo.uploaded.v1`, `photo.approved.v1`, `photo.rejected.v1` | none |
| `discovery` | nothing in Postgres; reads published views | `nextCards` | `deck.served.v1` (impressions) | `profile.updated.v1`, `photo.approved.v1`, `user.blocked.v1`, `match.created.v1` |
| `matching` | swipes, matches | `areMatched` | `match.created.v1`, `match.unmatched.v1` | `user.blocked.v1`, `user.deleted.v1` |
| `chat` | conversations, messages, read cursors | `openConversation` | `message.created.v1` | `match.created.v1`, `match.unmatched.v1`, `user.blocked.v1` |
| `notifications` | notification prefs, delivery log | `notify` | none | `match.created.v1`, `message.created.v1`, `report.created.v1` |
| `safety` | blocks, reports, bans, verification reviews | `blockPolicy`, `isBanned` | `user.blocked.v1`, `report.created.v1`, `user.banned.v1` | `photo.rejected.v1` |
| `admin` | audit log | none | none | `report.created.v1` |
| `platform` | outbox, inbox, feature flags, idempotency | flags, bus, jobs | none | none |

### 6.2 The module manifest

A module tells the system what it adds through one declaration. The registry reads it, checks it with zod, sorts modules by `dependsOn`, injects the APIs they asked for, and registers only what the current role needs:

```js
// src/modules/matching/manifest.js
import { defineModule } from '../../platform/registry.js';

export default defineModule({
  name: 'matching',
  version: 1,
  dependsOn: ['identity', 'safety'],          // APIs injected as deps.identity, deps.safety
  api: (deps) => createMatchingApi(deps),      // what other modules may call
  http: { prefix: '/v1', routes: () => import('./adapters/http/routes.js') },
  socket: { handlers: () => import('./adapters/socket/handlers.js') },
  jobs: { 'matching.write-passes': () => import('./adapters/jobs/write-passes.js') },
  subscribe: { 'user.blocked.v1': () => import('./adapters/events/on-user-blocked.js') },
  contribute: { 'discovery.candidateFilters': () => import('./adapters/pipeline/exclude-swiped.js') },
  flags: ['matching.undo-last-pass'],
  admin: { panels: () => import('./adapters/admin/panels.js') },
  migrations: new URL('./migrations', import.meta.url),
});
```

The list of modules is explicit, so a new module is one line:

```js
// src/modules/index.js
export default [identity, profiles, media, safety, discovery, matching, chat, notifications, admin];
```

At boot, `ROLE=api` registers `http`, `ROLE=ws` registers `socket`, and `ROLE=worker` registers `jobs`, `subscribe` and the scheduled jobs. A cycle in `dependsOn` fails the boot with a clear error.

Later features use three more manifest keys: `sections` (profile section types), `messageKinds` (chat message types) and `templates` (notification templates). The owning modules (`profiles`, `chat`, `notifications`) read these registries, so they never change when a feature adds an entry.

### 6.3 The twelve extension points

| # | Extension point | What you add | Loaded by role | Example future use |
| --- | --- | --- | --- | --- |
| 1 | HTTP routes | A Fastify plugin under `/v1` with zod request and response schemas | api | `GET /v1/prompts` |
| 2 | Socket events | Handlers for client-to-server events, with an ack | ws | `typing.start` |
| 3 | Event subscriptions | A handler for a versioned domain event | worker | `growth` rewards a referrer on `user.created.v1` |
| 4 | Jobs | A BullMQ processor in a named queue class (`fast`, `bulk`, `media`, `external`) | worker | Story expiry |
| 5 | Scheduled jobs | A cron pattern + processor, run once across all workers | worker | Nightly re-verification reminders |
| 6 | Ports with swappable adapters | A new implementation of an existing port | any | Liveness check behind `VerificationProvider` |
| 7 | Pipelines | An ordered step in a named chain owned by another module | any | A premium boost as a step in `discovery.scorers` |
| 8 | Feature flags and entitlements | A flag key with rollout rules, or an entitlement check | any | `stories.enabled` for one campus |
| 9 | Profile sections | A new section type with a zod schema, stored in `profiles.profile_sections` | api | Prompts, interests, clubs |
| 10 | Notification templates and channels | A template id + channels + batching rule | worker | "Your story got 5 views" |
| 11 | Admin panels | A panel definition (list, detail, actions) rendered by the admin app | api | Story moderation queue |
| 12 | Client feature registry and UI slots | A frontend feature that fills named slots (section 10) | client | A "Stories" home tab |

### 6.4 Pipelines: extending another module without editing it

Some modules expose ordered chains that other modules can add steps to. Each chain has a fixed input and output shape in `packages/contracts/pipelines`:

| Pipeline | Owner | Step shape | v1 steps |
| --- | --- | --- | --- |
| `discovery.candidateFilters` | discovery | `(viewer, candidates) => candidates` | exclude self, exclude swiped (matching), exclude blocked (safety), age and gender preferences |
| `discovery.scorers` | discovery | `(viewer, candidate) => { score, reason }` | recency, profile completeness, mutual-interest boost, new-user exposure |
| `chat.messageFilters` | chat | `(message) => allow / reject / flag` | length limit, link limiter, block check |
| `safety.contentChecks` | safety | `(content) => verdict` | image moderation API, text keyword list |
| `profiles.cardFields` | profiles | `(card) => card` | photos, prompts (later) |

A step declares `order` and a timeout. A step that throws or times out is skipped and logged, except in safety pipelines, which fail closed.

### 6.5 The event bus: outbox, per-consumer queues and inbox

Domain events are the main way features extend each other without coupling:

1. A use case calls `emit(EventSchema, payload)`. The platform writes the event into `platform.outbox` in the same transaction as the business change ([pattern](https://microservices.io/patterns/data/transactional-outbox)).
2. The relay reads unpublished rows with `FOR UPDATE SKIP LOCKED` and fans each event out to one BullMQ queue per subscribing module (`evt.chat`, `evt.notifications` ...), with the outbox id as the job id.
3. Each consumer runs its handler and its `platform.inbox` insert in one transaction. The inbox key is `(consumer, event_id)`, so a redelivered event is a no-op.
4. A failing consumer retries with backoff, then lands in its own dead-letter queue. Other consumers carry on.

Every event carries `id`, `name`, `version`, `occurredAt`, `traceId` and `payload`, and has a zod schema in `packages/contracts/events`.

### 6.6 Adding a new backend layer

| You want to add | Do this | Touches |
| --- | --- | --- |
| A cross-cutting behaviour (audit, quotas, caching of queries) | A new decorator in the use-case pipeline (5.4) | `src/platform` only |
| A new datastore for one module (for example ScyllaDB for messages) | A new adapter for that module's port, behind a flag, dual-written during migration | One module's `adapters/` |
| A new external provider (payments, SMS, liveness) | A new port in the owning module, plus an adapter with timeout, retry and circuit breaker | One module |
| A search or ranking service | A new adapter behind `Ranker` or `CandidateSource`, fed by events | discovery |
| An analytics pipeline | A subscriber that copies chosen events to a warehouse sink | New `analytics` module |
| A separate service (extract a module) | Run the module in its own process; replace the in-process `api.js` with an HTTP client that implements the same API; move its queues | That module + its callers' wiring |

### 6.7 Feature flags

- Flags live in `platform.feature_flags` with a rule list: campus ids, cohort, percentage (hash of user id), platform, minimum app version, and an on/off kill switch.
- The flag set is cached in Redis for 30 s and evaluated on the server. Clients receive their evaluated flags from `GET /v1/config` at startup and on resume.
- Every new feature ships dark, turns on for one campus, then widens. Remove a flag within two releases of 100% rollout.
- Entitlements (premium later) use the same evaluation path, backed by the `billing` module through an `Entitlements` port.

### 6.8 Contract versioning rules

- Events are named `noun.verb.vN`. Add optional fields freely. A breaking change publishes `v2` alongside `v1` until every consumer has moved.
- REST stays at `/v1`. New fields are additive; clients must ignore unknown fields. A breaking change gets a new route, never a changed one.
- Socket events follow the event rule: `message.new` gains fields, and a breaking change becomes `message.new.v2`.
- Database changes follow expand, migrate, contract across at least two deploys (section 7.6).

## 7. Data architecture

Postgres holds every fact that matters, split into one schema per module. Redis holds only what can be rebuilt, and R2 holds photos. Two decisions differ from v1. Swipes and messages are hash-partitioned from the very first migration, because converting a large live table later is a rewrite. And there are no foreign keys across module schemas.

### 7.1 Schemas and ownership

| Schema | Tables | Published read-only views |
| --- | --- | --- |
| `identity` | `users`, `auth_sessions`, `devices` | `identity.active_users_v` |
| `profiles` | `profiles`, `photos`, `profile_sections` | `profiles.candidates_v` |
| `media` | `uploads` | none |
| `matching` | `swipes` (16 hash partitions), `matches` | `matching.seen_v`, `matching.likes_in_v` |
| `chat` | `conversations`, `messages` (16 hash partitions), `read_cursors` | none |
| `notifications` | `prefs`, `deliveries` | none |
| `safety` | `blocks`, `reports`, `bans`, `verification_reviews` | `safety.block_pairs_v` |
| `admin` | `audit_log` | none |
| `platform` | `outbox`, `inbox`, `feature_flags`, `colleges`, `campus_clusters` | `platform.colleges_v` |

Each module connects with its own Postgres role. That role can write only its own schema and read only the views other modules publish. Discovery's candidate query is the one deliberate multi-schema read, and it reads only views.

### 7.2 Core tables

Primary keys are UUIDv7: time-ordered, so B-tree inserts stay at the right edge of the index. Clients only ever see a separate random `public_id`.

```sql
-- platform
CREATE TABLE platform.colleges (
  id uuid PRIMARY KEY, name text NOT NULL, email_domains text[] NOT NULL,
  cluster_id uuid NOT NULL, city text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE platform.outbox (
  id bigserial PRIMARY KEY, name text NOT NULL, version smallint NOT NULL,
  payload jsonb NOT NULL, trace_id text, created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON platform.outbox (id) WHERE published_at IS NULL;
CREATE TABLE platform.inbox (
  consumer text NOT NULL, event_id bigint NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
CREATE TABLE platform.feature_flags (
  key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now()
);

-- identity
CREATE TABLE identity.users (
  id uuid PRIMARY KEY, public_id text UNIQUE NOT NULL, college_id uuid NOT NULL,
  email_hmac bytea UNIQUE NOT NULL, status text NOT NULL DEFAULT 'pending',
  birth_date date NOT NULL, grad_year smallint,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);

-- profiles
CREATE TABLE profiles.profiles (
  user_id uuid PRIMARY KEY, college_id uuid NOT NULL, cluster_id uuid NOT NULL,
  name text NOT NULL, gender smallint NOT NULL, interested_in smallint[] NOT NULL, bio text,
  min_age smallint NOT NULL DEFAULT 18, max_age smallint NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'pending', last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profiles.profile_sections (      -- extension point 9: new section types need no migration
  user_id uuid NOT NULL, type text NOT NULL, schema_version smallint NOT NULL,
  data jsonb NOT NULL, position smallint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);

-- matching
CREATE TABLE matching.swipes (
  swiper_id uuid NOT NULL, target_id uuid NOT NULL, direction smallint NOT NULL, -- 1 like, 0 pass
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (swiper_id, target_id)
) PARTITION BY HASH (swiper_id);
-- 16 partitions: matching.swipes_p0 ... swipes_p15 (FOR VALUES WITH (MODULUS 16, REMAINDER n))
CREATE INDEX swipes_likes_in ON matching.swipes (target_id, created_at) WHERE direction = 1;
CREATE TABLE matching.matches (
  id uuid PRIMARY KEY, user_low uuid NOT NULL, user_high uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), unmatched_at timestamptz,
  CHECK (user_low < user_high), UNIQUE (user_low, user_high)
);

-- chat
CREATE TABLE chat.conversations (
  id uuid PRIMARY KEY, match_id uuid UNIQUE NOT NULL, last_seq bigint NOT NULL DEFAULT 0,
  closed_at timestamptz
);
CREATE TABLE chat.messages (
  conversation_id uuid NOT NULL, seq bigint NOT NULL, sender_id uuid NOT NULL,
  client_msg_id uuid NOT NULL, kind text NOT NULL DEFAULT 'text', body text, media_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq), UNIQUE (conversation_id, client_msg_id)
) PARTITION BY HASH (conversation_id);
CREATE TABLE chat.read_cursors (
  conversation_id uuid, user_id uuid, last_read_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

-- safety
CREATE TABLE safety.blocks (
  blocker_id uuid, blocked_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked ON safety.blocks (blocked_id);
CREATE TABLE safety.reports (
  id uuid PRIMARY KEY, reporter_id uuid NOT NULL, target_id uuid NOT NULL,
  reason text NOT NULL, evidence jsonb NOT NULL, status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue ON safety.reports (status, created_at);
```

The remaining tables (`auth_sessions`, `devices`, `photos`, `uploads`, `prefs`, `deliveries`, `bans`, `verification_reviews`, `audit_log`) keep their v1 shape, moved into their module's schema.

### 7.3 Design notes

- **Pairs exist once.** Matches store the pair in canonical order (`user_low < user_high`), and a unique constraint backs it.
- **Read state is one cursor** per user per conversation, not a row per message.
- **No counters on hot rows.** Like counts live in Redis and are flushed periodically, so a popular profile never becomes a hot row.
- **Partition keys sit inside the primary keys.** Postgres requires a unique constraint on a partitioned table to include the partition key. `(swiper_id, target_id)` and `(conversation_id, seq)` already do.
- **Unmatch is permanent.** The like rows stay, so the pair never reappears, and the match row is never reused.
- **Message kinds.** `kind` (`text`, `image`, later `icebreaker`, `story_reply`) lets chat features add message types without a migration.
- **No cross-schema foreign keys.** Consistency across modules comes from events and a nightly consistency job. Foreign keys stay inside a schema, on low-volume tables only.
- **Email is never stored in clear.** `email_hmac` is HMAC-SHA256 with a server-side secret, so a leaked table cannot be matched against a list of emails.

### 7.4 Redis keyspace

Every key starts with its owning module's name, so ownership is visible in a `SCAN`.

| Key | Type | TTL | Owner | Purpose |
| --- | --- | --- | --- | --- |
| `discovery:deck:{uid}` | list | 24 h | discovery | About 50 pre-ranked candidate ids |
| `discovery:served:{uid}` | set | 24 h | discovery | Ids already served, so swipes can be validated |
| `profiles:card:{uid}` | hash | 10 min | profiles | Hydrated card cache, invalidated on edit |
| `identity:otp:{emailHmac}` | hash | 10 min | identity | OTP hash and attempt count |
| `safety:blocked:{uid}` | set | none | safety | Fast block check at read time |
| `chat:presence:{uid}` | string | 60 s | chat | Heartbeat; only a coarse "active recently" is exposed |
| `platform:rl:{scope}:{id}` | counter | window | platform | Rate limits |
| `platform:idem:{scope}:{key}` | string | 24 h | platform | Stored results for idempotent writes |
| `platform:flags` | hash | 30 s | platform | Feature flag cache |
| `bull:*`, `socket.io*` | various | n/a | platform | Queues and socket fan-out |

Use two ioredis clients per process for Socket.IO (publisher and subscriber), and a separate connection for BullMQ with `maxRetriesPerRequest: null`, which BullMQ requires.

### 7.5 Retention

| Data | Kept for | Mechanism |
| --- | --- | --- |
| Passes | 30 days | Nightly batched delete per partition |
| Likes and matches | Account lifetime | Deleted on account deletion |
| Messages | Until account deletion or unmatch + 30 days | Kept briefly after unmatch for reports |
| OTP codes | 10 minutes | Redis TTL |
| Raw photo uploads | 1 day | R2 lifecycle rule |
| Report evidence | 1 year after closure | Then purged (confirm with legal review) |
| Application logs | 30 days | Log platform retention; no message bodies or emails in logs |
| Deleted accounts | Erased within 30 days | `user.deleted.v1` drives every module's erase handler |

### 7.6 Migrations: expand, migrate, contract

Migrations live in each module's `migrations/` folder and are run by node-pg-migrate in timestamp order. A breaking change is spread over three deploys so old and new code can run together:

1. **Expand.** Add the new column or table; the code writes both old and new.
2. **Migrate.** Backfill in batches of 5,000 rows from a job; the code reads the new one.
3. **Contract.** Drop the old column once no running version reads it.

Migrations run before the rolling deploy, so every migration must be safe for the code version still running. Use `CREATE INDEX CONCURRENTLY` on large tables, and never rewrite a table in place.

## 8. Communication and core flows

Modules talk through four channels, chosen by the guarantee each interaction needs. Every user-facing flow below is built only from these four.

### 8.1 Four channels

| Channel | Used for | Guarantee | Example |
| --- | --- | --- | --- |
| In-process API call | A question one module asks another | Synchronous; can share the caller's transaction | Matching asks `safety.blockPolicy.isBlocked()` |
| HTTPS or WebSocket | Client to backend | Request and response; retried by the client with an idempotency key | Post a swipe, send a message |
| Outbox → relay → per-consumer queue → inbox | Facts that other modules react to | At-least-once delivery, exactly-once effect | `match.created.v1` opens a conversation and sends a push |
| Redis pub/sub (Socket.IO adapter) | Realtime fan-out between gateways | Fire-and-forget; gaps are covered by replay | Deliver a message to the gateway holding the recipient's socket |

### 8.2 The relay and the consumer

```js
// src/platform/events/relay.js
export async function relayOnce({ db, queues, subscribers }) {
  return db.begin(async (sql) => {
    const rows = await sql`SELECT id, name, version, payload, trace_id FROM platform.outbox
      WHERE published_at IS NULL ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED`;
    for (const row of rows) {
      const key = `${row.name}.v${row.version}`;
      for (const consumer of subscribers.get(key) ?? []) {
        await queues.events(consumer).add(key, row, { jobId: `${consumer}:${row.id}` });
      }
    }
    if (rows.length) {
      await sql`UPDATE platform.outbox SET published_at = now() WHERE id IN ${sql(rows.map((r) => r.id))}`;
    }
    return rows.length;
  });
}
```

Run it in a loop: poll every 200 ms while rows keep coming, and back off to 2 s when the table is empty. Delete published rows older than 7 days nightly.

```js
// src/platform/events/consume.js
export function makeConsumer({ db, consumer, handler, schema }) {
  return async (job) => {
    const event = schema.parse(job.data.payload); // zod: refuse malformed events
    await db.begin(async (sql) => {
      const [fresh] = await sql`INSERT INTO platform.inbox (consumer, event_id)
        VALUES (${consumer}, ${job.data.id}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (!fresh) return; // already processed: redelivery is a no-op
      await handler(event, { sql, traceId: job.data.trace_id });
    });
  };
}
```

Handlers with external side effects (push, email) cannot join the transaction. They use the event id as the provider's idempotency key where one exists, and otherwise accept a rare duplicate.

### 8.3 Onboarding and verification

1. The user enters a college email. The domain is checked against `platform.colleges.email_domains`.
2. A 6-digit OTP from `crypto.randomInt` is stored hashed in Redis for 10 minutes, with 5 attempts. It is rate-limited per email, IP and device.
3. On verify, `identity` creates the user and emits `user.created.v1`. It issues a 15-minute access JWT and a 30-day rotating refresh token, stored hashed per device. Reuse of a rotated token revokes the whole family.
4. Date of birth is checked: under 18 is refused, and nothing beyond the refusal is stored.
5. Profile and at least 2 photos go to `pending`, then `active` after moderation.
6. Colleges without student email use the fallback: student ID plus a selfie, reviewed in the admin queue. `grad_year` triggers re-verification after graduation.

### 8.4 Swipe to match

1. The client sends `POST /v1/swipes` with `targetId`, `direction` and a `swipeId` that is the idempotency key.
2. The use-case pipeline checks the token, the rate limit, and that the target is in `discovery:served:{uid}`.
3. A pass goes to the `bulk` queue and the API returns at once. A worker writes passes in batches of 500.
4. A like runs the `like` use case (5.3): insert the swipe, take the per-pair advisory lock, check the reverse like and the block policy, create the match, emit `match.created.v1`. All of this is one transaction.
5. The API returns `{ matched, matchId }`.
6. Consumers react: `chat` creates the conversation, `notifications` pushes to the person who liked first, and the gateway sends a live `match.new` to both users if online. `discovery` removes the pair from both decks.

If a user opens the chat before `chat` has processed the event (a gap of milliseconds), `chat.openConversation(matchId)` creates it on demand. The create is idempotent on `match_id`.

### 8.5 Deck refill

1. The API pops 10 ids from `discovery:deck:{uid}`. When fewer than 20 remain, it enqueues a refill with `jobId: deck:{uid}`, so duplicates are dropped.
2. The deck worker reads up to 500 candidates from the read replica through the published views.
3. It runs `discovery.candidateFilters`, then `discovery.scorers`, then diversifies (no near-duplicates in the first slots, and a cap per candidate per day).
4. It writes the top 50 ids and resets the 24-hour TTL.
5. The API hydrates ids from `profiles:card:*` in one pipeline and falls back to the replica for misses.
6. At read time it drops blocked, matched and deleted users using Redis sets, so a stale deck never shows them.

### 8.6 Sending a message

1. The sender emits `message.send` with a client-generated `clientMsgId`.
2. The gateway runs the `send` use case: token, rate limit, block policy, then `chat.messageFilters`.
3. One transaction: `UPDATE chat.conversations SET last_seq = last_seq + 1 ... RETURNING last_seq`, then insert the message with `ON CONFLICT (conversation_id, client_msg_id) DO NOTHING`.
4. After commit the message cannot be lost. The gateway acks the sender with id, seq and timestamp.
5. The gateway emits to the recipient's room (`user:{id}`), and the Redis adapter delivers it to whichever gateway holds that socket.
6. If presence says the recipient is offline, the same transaction also emits `message.created.v1`, and `notifications` sends the push.
7. On reconnect, the client sends its last seen `seq` per conversation, and the server replays the gap from Postgres.

The offline check happens before commit, so the push event is atomic with the message. A recipient who goes offline just after the check still gets the message on reconnect through step 7.

### 8.7 Photo upload

1. The client asks `media` for a presigned PUT URL, with size and content type fixed in the signature. The upload is recorded as `pending`.
2. The client uploads straight to R2 under `uploads/raw/`.
3. The client confirms. `media` emits `photo.uploaded.v1`.
4. The image worker checks magic bytes, strips EXIF (which can contain GPS), writes WebP at 1080 px and 400 px, and runs `safety.contentChecks`.
5. Approved: variants move under `photos/`, and `photo.approved.v1` makes the photo visible. Rejected: `photo.rejected.v1` tells the user. Raw uploads are never served.

### 8.8 Block, report and account deletion

- **Block** is immediate and strongly consistent. One transaction in `safety` creates the block and emits `user.blocked.v1`. Every read path checks `blockPolicy` and the `safety:blocked` set, so the block holds before consumers close the conversation and purge decks.
- **Report** goes to the moderation queue with an evidence snapshot. Thresholds auto-hide a profile pending review. Every admin action is audit-logged.
- **Account deletion** marks the user deleted, revokes sessions and emits `user.deleted.v1`. Every module erases or anonymises its own data in its handler. The admin dashboard shows any module that has not finished within 24 hours.

### 8.9 Event catalog

| Event | Producer | Consumers | Purpose |
| --- | --- | --- | --- |
| `user.created.v1` | identity | profiles, notifications | Create the empty profile, send a welcome |
| `user.deleted.v1` | identity | every module | Erase or anonymise data |
| `profile.updated.v1` | profiles | discovery | Refresh eligibility and caches |
| `photo.uploaded.v1` | media | media image worker | Process and moderate |
| `photo.approved.v1` | media | profiles, discovery | Make visible, update eligibility |
| `photo.rejected.v1` | media | profiles, safety | Tell the user; count repeat offences |
| `deck.served.v1` | discovery | analytics (later), ranker (later) | Impression log for learned ranking |
| `match.created.v1` | matching | chat, notifications, discovery | Open the conversation, push, purge decks |
| `match.unmatched.v1` | matching | chat, discovery | Close the conversation |
| `message.created.v1` | chat | notifications | Push for an offline recipient |
| `user.blocked.v1` | safety | discovery, chat, matching, notifications | Purge decks, close the conversation, cancel pushes |
| `report.created.v1` | safety | admin, notifications | Moderation review |
| `user.banned.v1` | safety | identity, discovery, chat | Revoke sessions and hide everywhere |

Consumers are idempotent (inbox) and tolerate reordering, since several relays run in parallel. Every call that crosses a process has a timeout (`AbortSignal.timeout(ms)` on fetch), retries with backoff and jitter, and carries the correlation id.

## 9. API and realtime contracts

Freeze these contracts in week 2, before the screens are built. REST carries requests and responses, and WebSocket carries server pushes and low-latency chat. Both are defined as zod schemas in `packages/contracts`, from which the OpenAPI spec and the typed client are generated.

### 9.1 REST conventions

- **Base path** `/v1`. Resources are plural nouns (`/v1/matches`). Actions that are not resources are verbs under a resource (`/v1/matches/{id}/unmatch`).
- **Ids** in URLs are `public_id`s, never internal UUIDs.
- **Pagination** is cursor-based: `?cursor=...&limit=20`, returning `{ items, nextCursor }`. No offsets.
- **Idempotency:** every `POST` takes an `Idempotency-Key` header (or a client id in the body, like `swipeId`). A repeated key returns the stored result.
- **Errors** use one envelope: `{ error: { code, message, details?, requestId } }`. `code` is a stable string such as `RATE_LIMITED`, `NOT_MATCHED` or `BLOCKED`.
- **Client version:** every request carries `X-App-Version`. `GET /v1/config` returns `minSupportedVersion`, so old builds can be forced to update.
- **Responses list their fields.** Fastify response schemas serialise only listed fields, so an endpoint cannot leak `email_hmac` or `birth_date`.

### 9.2 Core endpoints (v1)

| Method and path | Module | Purpose |
| --- | --- | --- |
| `POST /v1/auth/otp` | identity | Send a code to a college email |
| `POST /v1/auth/verify` | identity | Verify the code, return tokens |
| `POST /v1/auth/refresh` | identity | Rotate the refresh token |
| `DELETE /v1/me` | identity | Delete the account |
| `GET /v1/config` | platform | Evaluated flags, min app version, campus info |
| `GET /v1/me/profile`, `PATCH /v1/me/profile` | profiles | Read and edit own profile |
| `PUT /v1/me/profile/sections/{type}` | profiles | Write one profile section (extension point 9) |
| `POST /v1/media/uploads`, `POST /v1/media/uploads/{id}/confirm` | media | Presign and confirm a photo upload |
| `GET /v1/deck` | discovery | Next 10 cards |
| `POST /v1/swipes` | matching | Like or pass, returns `{ matched, matchId }` |
| `GET /v1/matches` | matching | List matches |
| `POST /v1/matches/{id}/unmatch` | matching | Unmatch |
| `GET /v1/conversations/{id}/messages?afterSeq=` | chat | History and gap replay |
| `POST /v1/blocks`, `POST /v1/reports` | safety | Block and report |
| `PUT /v1/me/notification-prefs` | notifications | Push preferences and quiet hours |
| `GET /v1/me/export` | identity | Data export (DPDP access right) |

### 9.3 Socket events

| Direction | Event | Payload | Ack or reply |
| --- | --- | --- | --- |
| Client → server | `message.send` | `{ conversationId, clientMsgId, kind, body }` | `{ ok, id, seq, createdAt }` or `{ error }` |
| Client → server | `message.read` | `{ conversationId, seq }` | none |
| Client → server | `sync` | `{ cursors: [{ conversationId, lastSeq }] }` | Missed messages, in order |
| Server → client | `message.new` | Message object with `seq` | Client reports `delivered` |
| Server → client | `match.new` | `{ matchId, user }` | none |
| Server → client | `conversation.closed` | `{ conversationId, reason }` | none |
| Server → client | `config.changed` | `{}` | Client refetches `/v1/config` |

Sockets authenticate with the access JWT in the handshake. They use the WebSocket transport only, a 25-second ping interval, and a re-auth when the token is refreshed.

### 9.4 Contract workflow

1. Write or change the zod schema in `packages/contracts`.
2. CI regenerates the OpenAPI spec and diffs it against `main`. A removed field or a narrowed type fails the build.
3. `packages/api-client` regenerates its typed functions and TanStack Query keys from the same schemas.
4. Contract tests run each route through `fastify.inject` and validate the response against its schema.

## 10. Frontend architecture

Web, mobile and admin share every non-visual line of code through workspace packages. Each app is organised by Feature-Sliced Design, so a new frontend feature is a new folder that fills named UI slots. It does not need edits in existing screens.

### 10.1 Monorepo packages

| Package | Holds | Used by |
| --- | --- | --- |
| `packages/contracts` | zod schemas for REST, sockets, events, pipelines | API, all apps |
| `packages/api-client` | Generated fetch functions, auth refresh, error mapping, TanStack Query key factories | All apps |
| `packages/realtime` | socket.io-client wrapper: connect, re-auth, `sync` on reconnect, outgoing message queue | Web, mobile |
| `packages/domain` | Pure shared rules: age from date of birth, validators, formatting | API, all apps |
| `packages/features-core` | Hooks per feature (`useDeck`, `useSwipe`, `useConversation`) with no UI | Web, mobile |
| `packages/ui-tokens` | Colours, spacing, type scale as plain JS | All apps |
| `packages/ui-web`, `packages/ui-native` | Design-system components per platform | Web + admin, mobile |
| `packages/i18n` | Strings (English first) | All apps |
| `packages/config` | ESLint, Prettier, Vitest presets | Everything |

The split matters: logic lives in `features-core` once, and only the view is written twice (React DOM and React Native).

### 10.2 Layers inside each app

Feature-Sliced Design orders code into layers, and a layer may import only from layers below it ([source](https://www.codecentric.de/en/knowledge-hub/blog/feature-sliced-design-and-good-frontend-architecture)):

| Layer | Holds | Vouch examples |
| --- | --- | --- |
| `app` | Providers, router, global styles, feature registry | QueryClient, auth gate, Expo Router root |
| `pages` (screens on mobile) | One route each, composition only | Discover, Matches, Chat, Profile, Settings |
| `widgets` | Large blocks made of features | Swipe deck, conversation view, profile card |
| `features` | One user action with business value | Swipe, send message, report user, edit section |
| `entities` | Business objects and their small UI | User, Match, Message, ProfileSection |
| `shared` | Domain-free code | UI kit re-exports, API client, utilities |

The import rule is enforced with ESLint boundary rules. Start with `app`, `pages` and `shared`, and extract `features` and `entities` once a second screen needs the code.

### 10.3 The client feature registry and UI slots

Every app exposes named slots. A feature declares which slots it fills, and the app renders whatever is registered there, filtered by the flags from `/v1/config`:

```js
// apps/mobile/src/features/prompts/index.js
export default defineClientFeature({
  name: 'prompts',
  flag: 'prompts.enabled',
  slots: {
    'profile.sections': { type: 'prompts', view: () => import('./ui/PromptsSection.jsx'), order: 20 },
    'profile.editor': { view: () => import('./ui/PromptsEditor.jsx'), order: 20 },
    'chat.composerActions': { view: () => import('./ui/IcebreakerButton.jsx'), order: 10 },
  },
  routes: [{ path: '/prompts/edit', screen: () => import('./ui/EditPromptsScreen.jsx') }],
});
```

| Slot | Where it renders | Future features that fill it |
| --- | --- | --- |
| `home.tabs` | Bottom tab bar | Stories, Events |
| `profile.sections` | Profile card and own profile | Prompts, interests, clubs |
| `profile.editor` | Edit profile screen | Every section type |
| `chat.composerActions` | Next to the message input | Icebreakers, photo send |
| `chat.messageRenderers` | Message list, keyed by `kind` | Story replies, icebreaker cards |
| `deck.cardBadges` | On a swipe card | Verified badge, premium boost |
| `settings.rows` | Settings list | Billing, data export |
| `admin.panels` | Admin navigation | Every server admin panel (extension point 11) |

### 10.4 State and data rules

- **Server state** lives only in TanStack Query, under keys from the factories in `api-client` (`keys.deck(uid)`, `keys.messages(conversationId)`).
- **Socket events write into the query cache**, so a screen never subscribes to sockets directly. `message.new` appends to `keys.messages(id)`, and `match.new` invalidates `keys.matches()`.
- **Optimistic writes** for swipes and messages. A message shows as `sending` until the ack returns its `seq`. It retries from the outgoing queue with the same `clientMsgId`.
- **Global client state** is limited to the session, evaluated flags and the socket status.
- **Offline:** the last deck page and the last 50 messages per conversation are persisted on mobile, so the app opens instantly.

### 10.5 Web, mobile and admin specifics

- **Web:** Vite SPA on Cloudflare, React Router, code-split per page. The landing page stays plain HTML.
- **Mobile:** Expo with Expo Router, EAS Build and over-the-air updates for JS-only changes. A native change needs a store release, so keep native modules to a fixed, reviewed list.
- **Admin:** a separate Vite app with its own login (admin audience claim, MFA). It renders panels from the server's admin-panel definitions, so a new moderation queue needs no admin-app code.

### 10.6 Adding a frontend feature

1. Add or extend the contract in `packages/contracts`; regenerate the client.
2. Write the hooks in `packages/features-core/<feature>` and test them with Vitest against a mock API.
3. Create `apps/<app>/src/features/<feature>/` with its views, and declare the slots and routes it fills.
4. Gate it with a flag, add analytics events, and ship it dark.
5. Add one Playwright flow test for the web happy path, and a manual checklist step for mobile.

## 11. Security, safety and privacy

Safety and privacy are launch blockers, not later features. A dating product holds sensitive data, must keep minors out, and can lose a campus to a single bad incident.

### 11.1 Authentication and sessions

- Passwordless OTP to a college email. The code is 6 digits, valid 10 minutes, 5 attempts, stored hashed.
- Access JWT valid 15 minutes, signed with `jose` (EdDSA). Keys rotate by `kid`, with the previous key accepted for 24 hours.
- Refresh tokens valid 30 days, one per device, stored hashed, rotated on every use. Reuse of a rotated token revokes the whole token family and signs out that device.
- Admin tokens carry a separate audience and require MFA.
- Cloudflare Turnstile on OTP requests stops scripted sign-ups.

### 11.2 Threats and controls

| Threat | Example | Control |
| --- | --- | --- |
| Account takeover | Stolen refresh token | Rotation with reuse detection; device list with remote sign-out |
| OTP abuse | Code brute force, email bombing | Rate limits per email, IP and device; Turnstile; attempt counter |
| Scraping and enumeration | Walking profile ids | Random `public_id`s; profiles visible only in a served deck or a match; per-user read limits |
| Location leaks | GPS in photo EXIF | EXIF stripped before any variant is stored; no precise location collected |
| Data exposure | Leaked backup or table | Encryption at rest; HMAC'd emails; per-module Postgres roles; response schemas list fields |
| Harassment | Repeated unwanted messages | Block is instant; message filters; report thresholds auto-hide |
| Ban evasion | New account after a ban | Ban keyed on the email HMAC and device; repeat-offence signals in `safety` |
| Minors | A 16-year-old signs up | Date-of-birth gate; reports for suspected minors go to the top of the queue; ID check in the fallback flow |
| Injection | SQL or header injection | postgres.js parameterises every tagged template; zod on every input; `@fastify/helmet` |
| Abuse of uploads | Malware or non-image files | Presigned size and type; magic-byte check; raw uploads never served |
| Insider misuse | Admin browsing chats | Admin reads chats only through a report; every admin action audit-logged |

### 11.3 Safety tooling in v1

- Block, report and unmatch from every profile and conversation.
- Photo moderation through `safety.contentChecks` before any photo is visible.
- A moderation queue in the admin app with evidence snapshots, actions (warn, hide, ban) and an audit trail.
- Auto-hide when reports cross a threshold, pending human review.
- A published safety page and an in-app safety centre.

### 11.4 India's DPDP Act and Rules

The DPDP Rules 2025 were notified in November 2025 with an 18-month phased rollout ([source](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)). Most operational duties (notice, security safeguards, breach reporting, retention, children's data) start about 18 months after notification, around May 2027 ([source](https://webiis08.mondaq.com/india/data-protection/1706890/a-closer-look-at-the-dpdp-rules-2025)). Vouch's beta is before that date, so build to the rules now rather than retrofitting.

| Obligation | What the rules say | What Vouch builds |
| --- | --- | --- |
| Notice and consent | Itemised notice; purpose-based consent | Versioned privacy notice; `identity.consents` table recording notice version, purposes and timestamp |
| Breach reporting | Inform affected users and the Board without delay, with a detailed report within 72 hours ([source](https://webiis10.mondaq.com/india/data-protection/1706722/legal-update-digital-personal-data-protection-rules-2025)) | Incident runbook with a 72-hour clock; templates for user and Board notices |
| Children | Verifiable parental consent before processing data of anyone under 18 ([source](https://www.biometricupdate.com/202511/india-notifies-its-sweeping-digital-personal-data-protection-rules)) | Vouch is 18+ only: refuse under-18 sign-ups and store nothing beyond the refusal |
| Retention and erasure | Purpose-based retention; notify users 48 hours before erasure for inactivity ([source](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025)) | Retention table (7.5); an inactivity job that warns 48 hours before erasing |
| Logs | A one-year minimum retention for certain processing logs ([source](https://theprint.in/india/india-activates-its-first-privacy-law-what-new-dpdp-rules-mean-for-protection-of-your-digital-data/2785348)) | Keep access and processing logs (not content) for 1 year; confirm scope with a lawyer |
| User rights | Access, correction, erasure, grievance redressal | `GET /v1/me/export`, profile edit, `DELETE /v1/me`, a published grievance contact |

This table is a starting map, not legal advice. Budget for a review by an Indian data-protection lawyer before the beta.

## 12. Scaling, reliability and observability

Vouch scales in three stages, and each stage is entered on a measured trigger, not a date. Nothing in the code changes between stages; only the deployment shape and a few settings do.

### 12.1 Stages

| Stage | Users | Deployment | Enter when |
| --- | --- | --- | --- |
| 1 Beta | 2k-20k | One `ROLE=all` process; one Postgres; one Redis | Day 94 |
| 2 Growth | 20k-200k | 3 API + 2 gateway + 2 worker processes; PgBouncer; a read replica for decks; paid Redis with a replica | p95 API latency over 300 ms, CPU over 60%, or more than 3k sockets on one process |
| 3 Scale | 200k-1M | 6 API + 6 gateway + 4+ worker processes (separate media workers); 8 vCPU primary + 2 replicas; Redis with a replica and failover | Growth-stage triggers recur, or 2 GB of new rows a day |

### 12.2 Bottlenecks, in the order they will appear

1. **Free-tier quotas** (beta): storage, compute hours, Redis commands. Track each one.
2. **Swipe table size and the "already seen" anti-join:** 30-day pass retention, hash partitions, and decks precomputed off the request path.
3. **Deck generation CPU:** cap the candidate pool at 500, and keep clusters to a city.
4. **WebSocket count and memory:** more gateway processes, a tuned heartbeat, and connection draining on deploy.
5. **Hot profiles:** counters in Redis, no row updates on popular profiles.
6. **Image processing CPU:** a separate `media` worker group with its own concurrency.
7. **Notification fan-out:** batching and digests ("you have 3 new likes").
8. **Replica lag:** route a user's reads to the primary for 5 seconds after their own write.

### 12.3 Service level objectives

| Objective | Beta | Scale |
| --- | --- | --- |
| API availability (monthly) | 99.5% | 99.9% |
| API latency, p95 | under 300 ms | under 200 ms |
| Deck page latency, p95 | under 250 ms | under 150 ms |
| Message delivery to an online recipient, p95 | under 1 s | under 500 ms |
| Push sent after the event, p95 | under 30 s | under 10 s |
| Outbox lag (oldest unpublished event) | under 10 s | under 2 s |

An error budget follows each objective: 99.5% allows about 3.6 hours of downtime a month. When the budget is spent, feature work pauses for reliability work.

### 12.4 Failure modes

| Failure | User sees | Automatic response | Recovery |
| --- | --- | --- | --- |
| Postgres primary down | Writes fail; a retry banner | Clients retry with backoff; reads fall back to cache | Host failover; Scale stage promotes a replica |
| Read replica down or lagging | Slower decks | Reads fall back to the primary | Rebuild the replica |
| Redis down | No new decks for a moment; sockets reconnect | Decks rebuild from SQL; rate limits fail open for reads and closed for OTP | Restart; events replay from the outbox |
| A gateway crashes | Socket reconnects | Clients reconnect to another gateway and `sync` | None needed |
| A consumer keeps failing | That side effect is delayed | Retries, then its own dead-letter queue | Fix, then replay the dead-letter queue |
| A third party is down (push, email, moderation) | Delayed push, delayed photo approval | Circuit breaker opens; jobs wait | Jobs drain when it recovers |

### 12.5 Backups and recovery targets

| Stage | Data loss target | Recovery time target | Mechanism |
| --- | --- | --- | --- |
| Beta | 24 hours | 4 hours | Nightly `pg_dump` to R2, or the host's point-in-time recovery |
| Growth | 5 minutes | 1 hour | Point-in-time recovery on a paid plan |
| Scale | 1 minute | 15 minutes | Replica promotion; standby in a second zone |

Run a restore drill into a scratch database every month, and record how long it took.

### 12.6 Observability

- **Logs:** pino JSON with request id, trace id, user public id and module. Emails, tokens and message bodies are redacted.
- **Traces:** OpenTelemetry spans for every use case. The trace id is stored on outbox rows, so one trace follows a like from the API through the relay into every consumer.
- **Metrics:** request rate, errors and duration per route; event-loop lag per process; socket count; queue depth and oldest-job age per queue; outbox lag; consumer lag and dead-letter count per consumer; replica lag; Redis memory; free-tier usage.
- **Alerts:** page on API error rate above 2% for 5 minutes, outbox lag above 60 s, a non-empty dead-letter queue, replica lag above 10 s, Redis memory above 70%, a backup older than 26 hours, or any free-tier quota above 80%.
- **Dashboards:** one per module (its use cases, its queues, its consumers) plus one system overview.

## 13. Build order: what to design first and what to code first

**Design outside-in, code inside-out.** Design runs from the product down to the data: scope, capacity, data model, contracts, then screens. Code runs from the data up to the screens: platform kernel, migrations, domain, use cases, adapters, API, client hooks, screens. The rule behind both: whatever is most expensive to change later is decided first.

### 13.1 The order, layer by layer

| # | Layer | Cost to change later | Design in | Code in | Why here |
| --- | --- | --- | --- | --- | --- |
| 1 | Product scope and invariants ("a pair matches once", "18+ only") | Very high | Days 1-2 | None | Every later choice serves these |
| 2 | Capacity math and architecture decisions (ADRs) | High | Days 2-4 | None | Decides partitioning, pooling and the number of processes before any table exists |
| 3 | Domain model and database schema: entities, ids, partition keys, ownership per module | Highest | Days 3-7 | Days 8-14 (migrations) | Data outlives code. A wrong partition key or id scheme means rewriting live tables |
| 4 | Contracts: REST, socket events, domain events, jobs (zod) | High | Days 6-10 | Days 8-14 | Lets backend and frontend build in parallel against a frozen interface |
| 5 | Platform kernel: config, logger, db, redis, unit of work, outbox, inbox, registry, flags, auth, errors, use-case pipeline | High | Days 6-10 | Days 8-21 | Every module depends on it. Building it once avoids ten slightly different versions |
| 6 | CI/CD, environments, test harness (Testcontainers) | Medium | Days 1-3 | Days 3-10 | Every later commit runs through it, so it pays back from day one |
| 7 | Module skeletons: manifest, ports, empty use cases | Medium | Day 14 | Days 15-17 | Fixes the boundaries before any logic lands in the wrong module |
| 8 | Backend feature slices, in dependency order (13.2) | Medium | One slice ahead of the code | Days 15-85 | Each slice is usable end to end before the next starts |
| 9 | Design system and app shell (tokens, UI kit, navigation, auth gate) | Medium | Days 5-20 (wireframes first) | Days 18-30 | Screens built on a kit stay consistent and are faster to make |
| 10 | Screens per slice | Low | About 1 week before the slice's code | About 1 week after its backend | Built against a working API, not mocks that drift |
| 11 | Observability, load tests, security review, runbooks | Medium | Days 40-60 | Days 60-85 | Needs real flows to measure; must finish before users arrive |

### 13.2 Order of the backend slices

1. **identity** (OTP, tokens, devices). Everything needs a user and a session.
2. **profiles + media** (profile, sections, photo pipeline). Discovery needs eligible profiles with approved photos.
3. **safety, part 1** (`blockPolicy`, blocks, content checks). Discovery, matching and chat all call it, so its API must exist before they do.
4. **discovery** (candidate views, pipelines, decks). Needs profiles and the block policy.
5. **matching** (swipes, the match transaction, unmatch). Needs decks to validate swipes.
6. **chat** (conversations, messages, sequence replay, gateway). Needs matches.
7. **notifications** (push, email, preferences, batching). Consumes events from matching and chat.
8. **safety, part 2 + admin** (reports, moderation queue, bans, audit log). Needs every flow it moderates.

### 13.3 Inside one slice: the ten-step order

Every slice, for example `matching`, is built in this order. Each step has a test that must pass before the next starts.

1. **Contract:** write the zod schemas for its routes, socket events and events.
2. **Migration:** write the schema's SQL and run it against a Testcontainers Postgres.
3. **Domain:** pure functions and invariants, with unit tests.
4. **Use cases:** orchestration over ports, tested with in-memory fakes.
5. **Outbound adapters:** SQL and Redis implementations of the ports, with integration tests on real engines.
6. **Inbound adapters:** routes, socket handlers, job processors and event handlers, with contract tests through `fastify.inject`.
7. **Manifest:** register everything, behind the slice's feature flag.
8. **Client hooks:** in `packages/features-core`, tested against the running API.
9. **Screens:** in each app, filling their slots.
10. **End to end:** one Playwright flow, dashboards, alerts, then the flag turns on in staging.

### 13.4 What not to build first

- **Not microservices, Kubernetes or Kafka.** The ports make extraction mechanical later, and section 12 says when.
- **Not premium, stories or learned ranking.** Their extension points exist; the features wait until the core loop retains users.
- **Not pixel-perfect screens before the API works.** Wireframes first, the kit second, polish last.
- **Not your own auth crypto or image moderation model.** Use `jose` and a moderation API behind ports.

### 13.5 Days 1-7

| Day | Design | Code |
| --- | --- | --- |
| 1 | Write the invariants list and the v1 scope; open the ADR log | Create the Turborepo + pnpm repo, ESLint, Prettier, Vitest, dependency-cruiser |
| 2 | Capacity math from section 3, updated for your campus sizes | GitHub Actions: lint, test, build one Docker image |
| 3 | Entity list, ownership per module, id and partition-key choices | Testcontainers harness for Postgres and Redis |
| 4 | Draw the schema per module; list the published views | `src/platform/config.js` with zod; pino logger; graceful shutdown |
| 5 | Event catalog and REST list (sections 8-9) | Postgres and Redis clients; health and readiness routes |
| 6 | Wireframes for onboarding, deck, matches, chat | Unit of work and outbox writer, with tests |
| 7 | Review: invariants, schema and contracts frozen for v1 | Module registry and manifest loader with one empty module |

### 13.6 The 100-day plan

Superseded by the 15-phase plan in `docs/ROADMAP.md`.

Each phase follows the slice order in 13.2. The full gate checklists are in 14.6.

## 14. Repository, deployment, testing and code standards

One repo, one Docker image, three environments, and a test suite that runs against real engines. The gate checklists at the end of this section decide whether each roadmap phase is done.

### 14.1 Repository layout

```
vouch/
  apps/
    api/                      # the backend (all three roles)
      src/
        main.js               # reads ROLE, boots the registry
        platform/             # kernel: config, db, redis, uow, events, jobs, registry, flags, auth, use-case
        modules/
          index.js            # the explicit module list
          identity/  profiles/  media/  safety/  discovery/
          matching/  chat/  notifications/  admin/
      test/                   # cross-module invariant tests, k6 scripts
    web/                      # React + Vite (FSD layers under src/)
    mobile/                   # Expo (FSD layers under src/)
    admin/                    # React + Vite
    landing/                  # static HTML
  packages/
    contracts/  api-client/  realtime/  domain/  features-core/
    ui-tokens/  ui-web/  ui-native/  i18n/  config/
  docs/adr/                   # one file per architecture decision
  turbo.json  pnpm-workspace.yaml  Dockerfile  .dependency-cruiser.cjs
```

### 14.2 Environments

| Environment | Purpose | Data | Deploys |
| --- | --- | --- | --- |
| Local | Development | Synthetic seed (2k users, one campus) | `docker compose up` for Postgres + Redis; `node --watch` |
| Staging | Integration, load tests, demos | Synthetic only | Every merge to `main` |
| Production | Real users | Real, with backups and restore drills | Manual promotion of a tested image |

### 14.3 CI/CD pipeline

1. Install with `pnpm install --frozen-lockfile`.
2. Lint (ESLint, including boundary rules), format check, JSDoc check, dependency-cruiser layer check.
3. Unit tests, then integration tests on Testcontainers Postgres and Redis.
4. OpenAPI and event-schema diff against `main`; a breaking change fails the build.
5. Dependency audit (`pnpm audit --prod`).
6. Build one Docker image tagged with the commit.
7. Deploy to staging; run the expand-step migrations; smoke tests and one Playwright flow.
8. A human approves promotion.
9. Rolling production deploy, watching health and error rate, with automatic rollback. Gateways drain sockets over 30 s before stopping.

### 14.4 Testing strategy

| Level | Tests | Tool | Runs |
| --- | --- | --- | --- |
| Domain | Pure rules and invariants | Vitest | Every commit, milliseconds |
| Use case | Orchestration with in-memory port fakes | Vitest | Every commit |
| Adapter | SQL, Redis and R2 adapters on real engines | Vitest + Testcontainers | Every commit |
| Contract | Every route and socket event against its zod schema | `fastify.inject` | Every commit |
| Invariant | "Simultaneous likes create exactly one match", "no message lost across a gateway restart", "a block hides both users everywhere" | Vitest, concurrent clients | Every commit |
| End to end | Onboarding, swipe to match, chat, block | Playwright | Every staging deploy |
| Load | Peak model from section 3 at 10x beta (470 req/s, 6k sockets) | k6 | Weekly from day 60; gate on day 85 |
| Chaos | Kill a gateway, a worker and Redis mid-test | Scripted | Before each gate |

### 14.5 JavaScript code standards

- Every file starts with `// @ts-check`. Public functions carry JSDoc types; ports are JSDoc `@typedef`s.
- zod parses every value that crosses a boundary: requests, socket payloads, events, jobs, env vars and third-party responses.
- Named exports everywhere except `manifest.js` files.
- No `class` for business logic; factories and plain functions make dependency injection explicit.
- Errors are typed: `new AppError('NOT_MATCHED', 409)`. Never throw strings.
- Every async call to the network has a timeout. No floating promises (ESLint rule).
- Time and ids come from injected `clock` and `newId`, so tests are deterministic.
- SQL lives only in `adapters/pg/` files of the owning module.

### 14.6 Gate checklists

Gate 1, day 50 (core loop):

- [ ] A seeded user verifies, builds a profile, gets a deck, swipes and matches on staging
- [ ] Simultaneous-like invariant test passes 1,000 runs
- [ ] Block policy hides blocked users from decks and swipes
- [ ] Web and mobile shells run against staging

Gate 2, day 72 (chat and notifications):

- [ ] Messages survive a gateway kill with no loss or duplicates
- [ ] Offline recipients get a push within 30 s at p95
- [ ] Account deletion completes in every module

Gate 3, day 85 (launch readiness):

- [ ] k6 at 470 req/s and 6k sockets meets the beta SLOs
- [ ] Security review and threat table (11.2) checked
- [ ] Restore drill done and timed
- [ ] Moderation queue, reports and bans work end to end
- [ ] Privacy notice, consent records and grievance contact published

## 15. Worked example: adding profile prompts and icebreakers

This is the test of the architecture: a real post-v1 feature added with two one-line edits outside new folders. Prompts are short questions a user answers on their profile. An icebreaker is a chat message that replies to one of them.

### 15.1 Backend

1. **Contracts.** Add `packages/contracts/sections/prompts.js` (up to 3 `{ promptId, answer }` items, 150 characters each) and a message kind `icebreaker` with `{ promptId, quote }`.
2. **New module `prompts`.** It owns `prompts.catalog` (the question list) and declares its manifest:

```js
// src/modules/prompts/manifest.js
export default defineModule({
  name: 'prompts',
  version: 1,
  dependsOn: ['profiles'],
  http: { prefix: '/v1', routes: () => import('./adapters/http/routes.js') }, // GET /v1/prompts
  sections: { prompts: () => import('@vouch/contracts/sections/prompts.js') }, // extension point 9
  contribute: {
    'profiles.cardFields': () => import('./adapters/pipeline/add-prompts.js'),
    'discovery.scorers': () => import('./adapters/pipeline/answered-prompts-boost.js'),
  },
  messageKinds: { icebreaker: () => import('@vouch/contracts/messages/icebreaker.js') },
  flags: ['prompts.enabled'],
  admin: { panels: () => import('./adapters/admin/catalog-panel.js') },
  migrations: new URL('./migrations', import.meta.url),
});
```

3. **One line** in `src/modules/index.js` adds `prompts` to the module list.
4. `profiles` already stores any registered section type in `profile_sections`, and `chat` already accepts any registered message kind. Neither module changes.

### 15.2 Frontend

1. Hooks in `packages/features-core/prompts` (`usePromptCatalog`, `useSavePrompts`).
2. `apps/mobile/src/features/prompts/` fills `profile.sections`, `profile.editor`, `chat.composerActions` and `chat.messageRenderers` (code in 10.3).
3. **One line** adds the feature to the app's feature list. The web app follows the same steps.

### 15.3 Rollout

The feature ships dark, turns on for one campus with `prompts.enabled`, and is watched on its own dashboard. A bad release is switched off in 30 seconds without a deploy.

### 15.4 Adding a new backend layer: a query cache

A cache for read use cases is one decorator in the pipeline (5.4), opted into per use case:

```js
// src/platform/decorators/with-query-cache.js
export const withQueryCache = ({ redis, key, ttlSeconds }) => (next) => async (input, ctx) => {
  if (!key) return next(input, ctx);
  const k = `cache:${key(input, ctx)}`;
  const hit = await redis.get(k);
  if (hit) return JSON.parse(hit);
  const result = await next(input, ctx);
  await redis.set(k, JSON.stringify(result), 'EX', ttlSeconds);
  return result;
};
```

Swapping the hand-tuned ranker for a learned one is the same shape at the port level: a new `Ranker` adapter that calls the model service with a 150 ms timeout and falls back to the hand-tuned scorers.

## 16. Decisions, risks and open items

### 16.1 Architecture decisions

| # | Decision | Rejected alternatives | Revisit when |
| --- | --- | --- | --- |
| ADR-1 | Modular monolith, hexagonal modules, roles per process | Microservices; a layered monolith | A module needs separate scaling or a separate team |
| ADR-2 | One Postgres schema and role per module; no cross-schema foreign keys | One shared schema | Never for v1 |
| ADR-3 | Outbox + per-consumer queues + inbox for events | Direct BullMQ jobs from use cases; Kafka | Replay or many external consumers are needed |
| ADR-4 | Hash-partition swipes and messages from the first migration | Partition later | Not expected |
| ADR-5 | Manifests + an explicit module list | Filesystem auto-discovery | Not expected: explicit is easier to debug |
| ADR-6 | Pipelines for discovery, chat and safety extension | Hooks scattered in services | Pipelines add measurable latency |
| ADR-7 | Feature-Sliced Design + UI slots on every client | Folder-per-type | Not expected |
| ADR-8 | 30-day pass retention | 90 days (v1) | Beta shows users run out of candidates |

### 16.2 Risks

1. **Density, not technology.** A few thousand verified students on one campus beat a polished app with 50 users per campus. Launch narrow.
2. **Verification coverage.** Students who cannot verify cannot join. Build the ID fallback early.
3. **Abstraction overhead for a solo builder.** Ports, manifests and pipelines cost time up front. Keep the kernel small, and scaffold new modules with a generator script so a module starts in minutes.
4. **Debugging event-driven flows.** Side effects happen later and elsewhere. Trace ids on outbox rows, per-consumer dashboards and an admin event viewer make them visible.
5. **Free-tier cliffs.** Storage, compute hours and Redis commands all fail visibly (3.5). Alert at 80%.
6. **Safety incidents.** One bad incident can end a campus launch. Moderation and blocking are launch blockers.
7. **Runtime type errors.** Without a compiler, a wrong shape surfaces at runtime. zod at every boundary, JSDoc with `// @ts-check` and the invariant tests are the mitigation.
8. **Scope creep.** Prompts, stories and premium come after the core loop retains users. Their sockets exist; they can wait.
9. **Legal exposure.** Sensitive data and an age limit. Budget for an Indian data-protection lawyer and an incident-response plan before the beta.

### 16.3 Open items

- Every number in section 3 is an assumption. Replace it with beta data and rerun the script.
- Unverified: the Render Key Value price, Resend and Brevo free limits, the 500 req/s per-process figure (confirm with k6), and socket memory per connection.
- DPDP scope for log retention, and whether Vouch could be classed as a Significant Data Fiduciary later.
- Whether to adopt Node.js 26 and PostgreSQL 18 before or after the beta.

### 16.4 Sources

Pages opened while researching this plan, checked 21 November 2026:

- [Node.js release schedule](https://nodejs.org/about/releases/)
- [PostgreSQL 18 release notes](https://postgresql.org/about/news/postgresql-18-released-3142/)
- [Fastify encapsulation](https://fastify.dev/docs/v5.3.x/Reference/Encapsulation.md)
- [GitLab: hexagonal modular monolith](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/hexagonal_monolith)
- [Transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox)
- [Postgres unique constraints on partitioned tables](https://www.pgedge.com/blog/enforcing-constraints-across-postgres-partitions)
- [PgBouncer prepared statements in transaction mode](https://www.prisma.io/postgres/prepared-statement-already-exists)
- [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/)
- [Expo push notification limits](https://docs.expo.dev/push-notifications/faq/)
- [Expo New Architecture](https://docs.expo.dev/guides/new-architecture)
- [Feature-Sliced Design layers](https://www.codecentric.de/en/knowledge-hub/blog/feature-sliced-design-and-good-frontend-architecture)
- [Neon free plan limits](https://neon.com/faqs/free-plan-limits-and-quotas) and [Neon plans](https://neon.com/docs/introduction/limits)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing)
- [Upstash Redis billing](https://upstash.com/docs/redis/overall/billing)
- [Render free tier](https://render.com/docs/free) and [Render hosting costs](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses)
- [PIB: DPDP Rules 2025 notified](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- [Mondaq: a closer look at the DPDP Rules](https://webiis08.mondaq.com/india/data-protection/1706890/a-closer-look-at-the-dpdp-rules-2025) and [legal update](https://webiis10.mondaq.com/india/data-protection/1706722/legal-update-digital-personal-data-protection-rules-2025)
- [EY: DPDP Rules 2025](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025)
- [Biometric Update: DPDP children's data](https://www.biometricupdate.com/202511/india-notifies-its-sweeping-digital-personal-data-protection-rules)
- [ThePrint: DPDP one-year retention](https://theprint.in/india/india-activates-its-first-privacy-law-what-new-dpdp-rules-mean-for-protection-of-your-digital-data/2785348)
