## Phase 7 — Safety core and discovery engine: Completion Report

**Summary:**

- **Blocking:** a user can block someone. The block is visible both ways at once, and a blocked
  user never appears in a deck, not even a stale one.
- **Moderation:** photos go through the real `safety.contentChecks` pipeline with an Amazon
  Rekognition adapter. It rejects explicit content, holds borderline photos and possible minors
  for review, and never approves without a verdict.
- **Decks:** discovery precomputes ranked decks of eligible students from the viewer's cluster
  and serves them from Redis. On the 2,000-user seed, deck p95 is 117–135 ms at 10 concurrent
  requests, against a target of 250 ms.

**Completion criteria:**

- [x] **`GET /v1/deck` returns valid cards for seeded users,** with ordering explained by the
      scorer reasons logged at debug level. Evidence:
  - The integration test "the first request returns cards: [] … then 10 eligible, valid cards"
    checks every card against the contract and the database, and finds the reasons in the
    `deck built` log.
  - A curl run against the Docker image.
  - The example deck below.
- [x] **The block invariant test passes.** Evidence: "block invariant: a blocked user never
      appears…".
  - It checks both directions straight after the block, with the blocked user pushed to the
    head of both users' decks.
  - It also checks after the Redis sets are deleted, after the consumer runs, and after a
    rebuild.
- [x] **The deck p95 target is met.** `bench:deck`: p95 117.2 ms and 134.5 ms at concurrency
      10, and 22.1 ms at concurrency 1, over 1,000 requests.

**Owner decisions, as implemented:**

| Decision                        | How it was met                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Rekognition in ap-south-1    | `adapters/moderation/rekognition.js` (`DetectModerationLabels` and `DetectFaces`, run in parallel, timeouts); `MODERATION_AWS_REGION` defaults to `ap-south-1`. Checking Mumbai support and pricing with real keys is a Phase 15 note                             |
| 2. Image bytes in the pipeline  | `safety.contentChecks` input gains an optional `image` field (additive; `contracts:diff` passes). The 1080 px WebP is re-encoded to JPEG for Rekognition                                                                                                          |
| 3. Thresholds and the age check | Reject at 80% or more, review at 50% or more, for explicit nudity or sexual content, graphic violence or gore, and hate symbols. Suggestive content is allowed. A face with `AgeRange.High` below 18 goes to review only. All configurable through `MODERATION_*` |
| 4. Fail closed                  | A provider error throws; 3 attempts with backoff, then `processing_failed`. Integration test with the fake provider returning 500                                                                                                                                 |
| 5. Needs-review path            | Upload status `in_review` (expand-only migration), variants under private `review/…`, owner sees `pending`, no automatic decision, `media.api.resolveReview`. Phase 10 note: alert after 48 hours                                                                 |
| 6. Ranking defaults             | Weights base 0.25, recency 0.35, completeness 0.15, new user 0.25; half-life 72 h; 7-day boost; exposure cap 300 a day; at most 3 new users in the top 10; college alternation through `Candidate.collegeId` (additive). All `DISCOVERY_*`                        |
| 7. Empty deck                   | Returns `cards: []` and queues a build; the first deck is also built when a profile becomes active                                                                                                                                                                |
| 8. Impressions                  | One `deck.served.v1` per page (test checks the ids)                                                                                                                                                                                                               |
| Smaller points                  | No routes for `listBlocked` or `unblock` (Phase 13 note); job id `deck-{uid}`; all filters in discovery; `db.read(…, { replica: true })`                                                                                                                          |

**What was built:**

- `apps/api/src/modules/safety/**` (part 1):
  - Domain: block and moderation rules.
  - Use cases: block, unblock, list blocked; the block policy; bans; the image-moderation step.
  - Adapters: pg stores, the Redis block cache, Rekognition and development moderation, HTTP.
  - README.
- `apps/api/src/modules/discovery/**`:
  - Domain: deck constants, mutual preferences, scores, ranking and diversification.
  - Application: 5 filter steps and 4 scorer steps, one file each; the deck builder; the read
    path; consumers.
  - Adapters: the SQL candidate source, the Redis deck store, the hand-tuned ranker, the build
    queue, events, HTTP.
  - README.
- Media:
  - The pipeline-backed `ContentCheck`, with image bytes.
  - The `in_review` path with the `review/` prefix, and `resolveReview`.
  - Migration `20261122003200_upload_in_review.sql`.
- Kernel: replica support in `db.read`. Identity: `getUsersByPublicIds`.
- Contracts:
  - Image bytes on the `safety.contentChecks` input, and `Candidate.collegeId`.
  - Env: `MODERATION_*` and `DISCOVERY_*`.
- `apps/api/scripts/bench-deck.js` (`pnpm --filter @vouch/api bench:deck`).
- Docs: ADRs 0013 and 0014, `data-model.md`, CHANGELOG, PROGRESS.

**Pipeline steps and weights:**

| Chain                        | Step (order)                     | What it does                                                   |
| ---------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `safety.contentChecks`       | `safety.imageModeration` (10)    | Rekognition labels and face ages → approve, review or reject   |
| `discovery.candidateFilters` | `excludeSelf` (10)               | Removes the viewer                                             |
|                              | `excludeSwiped` (20, 250 ms)     | `matching.seen_v` for the viewer                               |
|                              | `excludeBlocked` (30, 250 ms)    | `safety.blockPolicy.blockedAmong`                              |
|                              | `excludeInactive` (40, 250 ms)   | `safety.bannedAmong`                                           |
|                              | `mutualPreferences` (50)         | Gender and age both ways                                       |
| `discovery.scorers`          | `recency` (10), weight 0.35      | 0.5^(hours since active / 72)                                  |
|                              | `completeness` (20), weight 0.15 | Approved photos / 6                                            |
|                              | `newUser` (30), weight 0.25      | 1 → 0 over the first 7 days                                    |
|                              | `exposureCap` (40), gate         | 0 once shown 300 times today                                   |
| Ranker                       | base 0.25                        | total = gate × (0.25 + Σ weight × score); top 50; diversify 10 |

**Tests and validation** (clean clone; Node v24.22.3, pnpm 10.34.9; every check run unpiped or
with `pipefail`):

```
pnpm lint / format:check / typecheck / check:boundaries / contracts:check / contracts:diff → ok
pnpm test (exit 0)
  @vouch/contracts  Tests 371 passed
  @vouch/config     Tests 4 passed
  @vouch/api        Tests 312 passed (40 files) · src/platform lines 98.33%
```

The API suite passed two more consecutive runs (312/312 each).

New and changed tests (+42 in the API):

- **Safety unit (9):**
  - Reject at 80% and above, including through a parent label; review at 50–80%; allow below.
  - Suggestive content allowed; possible minors to review only, with a configurable age.
  - No self-block; the step needs the image bytes.
  - The Rekognition adapter against a local fake endpoint: sends JPEG bytes and
    `MinConfidence` to both operations, skips faces when the check is off, throws on a provider
    error.
- **Moderation integration (5):** with SeaweedFS, the real chain and the fake Rekognition
  endpoint.
  - Suggestive content is approved, with JPEG bytes reaching the provider.
  - Explicit content is rejected as `moderation`.
  - A borderline label and a minor face are held `in_review` and shown to the owner as pending;
    `resolveReview` approves.
  - With the provider failing, the photo is rejected as `processing_failed` after 3 attempts.
- **Discovery unit (16):** each filter (with what it removed) and each scorer; ranker totals,
  reasons, the exposure gate, the size cap and configurable weights; diversification (college,
  new-user allowance, fallback).
- **Discovery integration (8)**, on the 2,000-user seed:
  - first request, then 10 eligible valid cards with reasons logged, `wasServed`, and one
    `deck.served.v1`
  - the block invariant
  - refusing a self-block or an unknown user
  - a banned user dropped at read time
  - a refill below 20
  - 25 concurrent refill requests producing one job
  - `PROFILE_INCOMPLETE`, and the deck dropped when a profile stops being active
  - replica reads using their own pool
- **Media (+5):** the `in_review` path, `resolveReview` (approve, reject, idempotent), releasing a
  held photo, and the strictest-verdict combination (no verdict throws).

Mutation checks (each reverted afterwards):

| Mutation                                | Result       |
| --------------------------------------- | ------------ |
| No read-time block and ban check        | 2 tests fail |
| Block without updating Redis            | 1 test fails |
| Trust an unloaded Redis block set       | 1 test fails |
| Approve when the chain gives no verdict | 1 test fails |
| No minor-face review                    | 2 tests fail |
| No exposure gate                        | 1 test fails |
| No job dedupe (no `deck-{uid}` id)      | 1 test fails |

CI's first push run failed once in the moderation integration suite. The upload reached
`in_review` before the profiles consumer had recorded the second pending photo; the two are
separate consumers, so this is correct, eventually consistent behaviour. The test now waits for
the profile view instead of reading it once, and passed 3 consecutive runs locally and in CI.

The moderation integration suite found a real bug that the in-memory fakes could not:
`resolveReview` locked a row inside a read-only transaction. It now uses a write transaction.

**Deck latency** (`pnpm --filter @vouch/api bench:deck`, `ROLE=all` process with Compose and the
2,000-user seed; 50 users, 1,000 requests; refills run in the same process while measuring):

| Concurrency | p50     | p95      | p99      | max      | Throughput | Full pages |
| ----------- | ------- | -------- | -------- | -------- | ---------- | ---------- |
| 10          | 32.5 ms | 134.5 ms | 171.4 ms | 225.7 ms | 188/s      | 1000/1000  |
| 10          | 25.6 ms | 117.2 ms | 141.7 ms | 164.2 ms | 220/s      | 1000/1000  |
| 1           | 6.7 ms  | 22.1 ms  | 28.9 ms  | 56.2 ms  | 112/s      | 1000/1000  |

- **First run:** 800 of 1,000 requests got 429. All requests came from one IP, and the Phase 4
  global limit is 300 per minute per IP. The benchmark now sends a distinct `X-Forwarded-For`
  per simulated user, as real clients behind the CDN would (see the known issues below).
- **Filter timeouts:** during the 50-build warm-up burst, the filters that query took more than
  50 ms and were skipped. They now have 250 ms (worker path only); there were 0 timeouts after
  the change.

**Example deck with reasons:**

- **Viewer:** a man aged 19, interested in women, wanting ages 18–28. 339 candidates, 0 removed
  by filters (the SQL already excludes them).
- **Demo data:** the seed's activity dates are from September and October 2026, so locally
  every candidate was made recently active, and 300 users were made to have joined in the last
  6 days. The seed script itself is unchanged.

```
 1. Meera, 20, Riverside, 3 photos    total 0.875  recency 0.95 (5 h); completeness 0.50; newUser 0.87; cap 1 (0/300)
 2. Kavya, 24, Northfield, 4 photos   total 0.841  recency 0.88 (13 h); completeness 0.67; newUser 0.73
 3. Aarav, 23, Riverside, 4 photos    total 0.870  recency 0.79 (25 h); completeness 0.67; newUser 0.97
 4. Kavya, 24, Northfield, 4 photos   total 0.699  recency 1.00 (0 h); completeness 0.67; established
 5. Ishaan, 25, Riverside, 4 photos   total 0.698  recency 0.99 (1 h); established
 6. Vihaan, 21, Northfield, 4 photos  total 0.698  recency 0.99 (1 h); established
 7. Rohan, 21, Riverside, 4 photos    total 0.689  recency 0.97 (3 h); established
 8. Kavya, 24, Northfield, 4 photos   total 0.695  recency 0.99 (1 h); established
 9. Reyansh, 19, Riverside, 4 photos  total 0.678  recency 0.94 (7 h); established
10. Priya, 25, Northfield, 4 photos   total 0.683  recency 0.95 (5 h); established
```

- **New users:** three boosted new users lead, the allowance of 3.
- **Colleges:** cards alternate between the two colleges, so slot 3 (0.870) comes after slot 2
  (0.841).
- **Names:** seed names repeat, so the three "Kavya" cards are different users.
- **Without the demo data:** all reasons read "active ~1,250 h ago; established", and the order
  is alternation plus recency.

**Moderation provider, cost and limits** (ADR 0013):

- Amazon Rekognition, `ap-south-1`.
- About $0.001 per image for the first million a month, lower at volume, per AWS's 2021 price
  announcement. That is about $70 for the beta's estimated 70,000 onboarding photos. `DetectFaces`
  is billed separately at a similar rate.
- Limits: JPEG and PNG only (the worker re-encodes), 5 MB as bytes, 10,000 px per side.
- Checking Mumbai moderation support and current pricing with real keys is a Phase 15 note.

**Other checks:**

- **Docker image `vouch-api:phase7`** (540 MB, 4 MB more for the Rekognition client): `/ready` is
  ok, `GET /v1/deck` returns 200 with 10 cards, no error logs, and `docker stop --time 30` exits
  with code 0.

**Decisions made:**

- [ADR 0013 — Photo moderation with Amazon Rekognition](../adr/0013-photo-moderation.md)
- [ADR 0014 — Discovery: precomputed decks and hand-tuned ranking](../adr/0014-discovery-ranking.md)

**Deviations from the roadmap:**

- **Job id `deck-{uid}`** instead of `deck:{uid}` (BullMQ ids can't contain `:`). Finished build
  jobs are removed at once, so the id deduplicates only while a build is waiting or running.
- **The `in_review` migration** (expand-only).
- **Filter steps that query get a 250 ms timeout** instead of 50 ms. They run only on the deck
  worker; scorers and the read path keep 50 ms.
- **Media keeps its in-memory `ContentCheck` port for tests,** while production wiring always
  uses the pipeline.
- **The `photo.approved.v1` consumer queues a rebuild of that user's own deck** (deduplicated),
  for the first deck after activation.
- **`excludeSwiped` and `excludeBlocked` repeat the SQL's exclusions.** The roadmap lists them as
  filters; they stay as an extension point and a second line of defence.

**Known issues and risks:**

- **Global rate limit keyed by IP (Phase 4 code).**
  - 300 requests per minute per IP would throttle a whole campus behind one NAT address, the
    case ADR 0011 handled for identity.
  - Not changed (rule A.2). Proposed fix: key the global limit by user for authenticated
    requests and by IP otherwise, with an IP ceiling sized for campuses.
- **`trustProxy: true` (Phase 4 code).** Any client that reaches the app directly can set
  `X-Forwarded-For` and evade per-IP limits. Proposed fix (Phase 15, with the CDN): trust only
  Cloudflare and Render hops, for example with a configured hop count or CIDR list.
- **Rekognition not tested with real keys.** The adapter was tested only against a fake
  endpoint, and the label names are assumed from its documented taxonomy. The real-key check is
  noted for Phase 15.
- **Photos in review wait for a person.** There is no automatic decision; the Phase 10 queue and
  48-hour alert handle it.
- **Exposure counts:** each worker keeps a map of counts for the day; across several workers they
  agree because the source is Redis.
- **First deck request:** the first request after a profile becomes active can return
  `cards: []` while the worker builds the deck (under a second locally).

**Suggested follow-ups (not done, need approval):**

1. Phase 4 fix, approval needed: the per-user global rate-limit key described above.
2. Phase 15: restrict `trustProxy` to the CDN and host proxies.
3. Phase 8: `wasServed` is ready for swipe validation; matching could take over `excludeSwiped`
   (ARCHITECTURE.md 6.4).
4. Phase 15: a seed option for realistic recent activity, so local decks rank meaningfully.

**How you can check it yourself:**

```bash
cp .env.example .env && pnpm dev:keys --write && docker compose up -d --wait && pnpm db:migrate && pnpm db:seed && pnpm storage:init
```

```bash
cd apps/api && node --env-file=../../.env src/main.js
```

```bash
pnpm --filter @vouch/api bench:deck --requests 1000 --concurrency 10 --users 50
```

```bash
pnpm --filter @vouch/api exec vitest run test/modules/discovery test/modules/safety
```

**Pull request:** [Tejas-lab-source/vouch#7](https://github.com/Tejas-lab-source/vouch/pull/7) · Branch:
`claude/lucid-rubin-foq2uj` (ADR 0002)
