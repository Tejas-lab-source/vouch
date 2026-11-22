## Phase 8 — Matching module: Completion Report

**Summary:** Students swipe through their decks, and a mutual like creates exactly one match,
even when both people like each other at the same instant. Unmatch is permanent and idempotent.
Passes are batched through Redis and written within about 5 s, and a deck built in the meantime
still leaves out anyone just passed. A blocked pair is never revealed: such a swipe answers
exactly like a pass. The phase began with your two Phase 4 fixes:

- **Rate limits:** the global limit now applies per user for signed-in requests, and per client
  IP otherwise, bad tokens included.
- **Client IP:** forwarded IP headers are believed only from `TRUSTED_PROXIES`.

**Completion criteria:**

- [x] **The simultaneous-likes invariant passes 1,000/1,000 runs.**
      `test/invariants/simultaneous-likes.test.js`: 1,000 fresh seeded pairs, each pair liking
      each other at the same moment, 20 pairs at a time.
  - Every pair gets exactly one match and exactly one `match.created.v1`.
  - Exactly one of the two answers says `matched: true`.
  - It passed in 4 local runs and in CI. The output is below.
- [x] **Seeded users can swipe through decks and match end to end with `ROLE=all`.**
      Demonstrated against the Docker image with real decks, no shortcuts; transcript below.
  - The script found a pair who appear in each other's decks.
  - A liked B, and B liked A back, which made a match.
  - The match appears in the match list, a pass reached Postgres after the flush, and unmatch
    worked twice.

**Owner decisions, as implemented:**

| Decision                               | How it was met                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 4 fix 1: rate limits             | Key `user:{id}` (`RATE_LIMIT_USER_MINUTE`, 300) for signed-in requests, `ip:{clientIp}` (`RATE_LIMIT_IP_MINUTE`, 1,000) otherwise. Auth split into `authenticate` (`onRequest`) and `enforce` (`preValidation`), so bad tokens are counted before they fail. OTP and verify limits unchanged                                          |
| Phase 4 fix 2: client IP               | `TRUSTED_PROXIES` (IPs or CIDRs, empty by default). From a trusted socket: `CF-Connecting-IP` first, else `X-Forwarded-For` across trusted hops; otherwise the socket address. All modules use `request.clientIp`. Phase 15 values recorded in PROGRESS                                                                               |
| 1. Pass buffer, and the deck exclusion | Redis buffer, with a flush every 5 s or at 500. Matching contributes `matching.excludeBufferedPasses` to `discovery.candidateFilters`, so a deck built before the flush leaves out pending passes. Tested                                                                                                                             |
| 2. `likesIn`                           | Use case and `api.likesIn` (count of unanswered likes, excluding blocked pairs). The route is a Phase 12 note in PROGRESS                                                                                                                                                                                                             |
| 3. Rate-limit defaults and bad tokens  | 300 per user and 1,000 per IP, both configurable. A flood of missing or bad tokens is throttled by IP (test)                                                                                                                                                                                                                          |
| 4. `CF-Connecting-IP`                  | Trusted only from `TRUSTED_PROXIES`, and preferred over `X-Forwarded-For` (test)                                                                                                                                                                                                                                                      |
| 5. Silent block                        | A swipe in a blocked pair (either direction) returns `{ matched: false, matchId: null }` and stores nothing. Test: the blocked user's response is byte-for-byte identical to a normal pass. `NOT_FOUND` for unknown or deleted targets; an existing match returns `{ matched: true, matchId }`; hidden cards are left out of the list |

**What was built:**

- **Platform:**
  - `client-ip.js` (`createProxyTrust`, `resolveClientIp`, `clientIpOf`).
  - `http.js`: `trustProxy` from the list, the `clientIp` decorator, and the limiter key and
    limits.
  - `auth.js`: `authHooks` with `authenticate` and `enforce`.
  - Readable messages for `NOT_SERVED` and `NOT_MATCHED`.
- **Modules:** identity, profiles, media, safety and discovery routes now use `clientIpOf`.
- **`apps/api/src/modules/matching/**`:**
  - Domain: `canonicalPair`, `decideMatch`, `judgeUnmatch`, cursors.
  - Use cases: swipe (like transaction and pass), pass batching, matches (unmatch, list,
    `likesIn`, `areMatched`, `getMatch`), consumers, retention, export.
  - Adapters: pg stores, the Redis pass buffer, the contributed deck filter, the queue, events
    and HTTP. README.
- **Profiles:** `api.isActive`.
- **Contracts (additive):**
  - Env: `TRUSTED_PROXIES`, `RATE_LIMIT_USER_MINUTE`, `RATE_LIMIT_IP_MINUTE`.
  - Jobs: `matching.flushPasses`, `matching.retentionTick`.
- **Tests:**
  - `test/invariants/simultaneous-likes.test.js`, run on its own (`pnpm test:invariants`, its
    own CI step).
  - `test/platform/client-ip.test.js`.
  - Matching unit and integration tests.
- **Docs:** ADRs 0015 and 0016, CHANGELOG, PROGRESS.

**Invariant output and pair-lock hold times.** The hold time runs from acquiring the
transaction-level lock to commit. There are 2,000 samples per run.

| Run                                  | Pairs with one match | Matches | Events | p50     | p95                | p99      | max      |
| ------------------------------------ | -------------------- | ------- | ------ | ------- | ------------------ | -------- | -------- |
| Local, alone, 1                      | 1000/1000            | 1000    | 1000   | 5.99 ms | 13.31 ms           | 22.34 ms | 46.02 ms |
| Local, alone, 2                      | 1000/1000            | 1000    | 1000   | 5.26 ms | 12.78 ms           | 22.61 ms | 36.05 ms |
| Local, alone, 3                      | 1000/1000            | 1000    | 1000   | 5.79 ms | 12.19 ms           | 19.94 ms | 36.35 ms |
| Local, alone, after the final change | 1000/1000            | 1000    | 1000   | 5.95 ms | 13.11 ms           | 17.87 ms | 32.75 ms |
| CI (GitHub runner), alone            | 1000/1000            | —       | —      | —       | < 20 ms (asserted) | —        | —        |

Run alongside the whole parallel suite (40 other test files, each with its own containers), the
invariant still held 1,000/1,000 every time, but its p95 reached 21.5 ms once, from CPU
contention. Two changes followed:

- **Fewer round trips under the lock:** the like-back check and the previous-match check are
  now one query.
- **Isolation:** the invariant runs alone, with its own config and CI step, so other suites
  can't skew its timing.

**Tests and validation** (clean clone; Node v24.22.3, pnpm 10.34.9; every check run unpiped or
with `pipefail`):

```
pnpm lint / format:check / typecheck / check:boundaries / contracts:check / contracts:diff → ok
pnpm test (exit 0)
  @vouch/contracts  Tests 375 passed
  @vouch/config     Tests 4 passed
  @vouch/api        Tests 336 passed · src/platform lines 98.42%
pnpm test:invariants (exit 0)  Tests 1 passed (1,000 pairs)
```

The API suite passed two more consecutive runs, and the invariant passed four runs alone. CI
run 49 (`b719a84`) passed both jobs, including the separate invariant step.

New tests (+25 in the API):

- **Rate limit and client IP (7):**
  - Proxy-trust unit cases: IPv4, IPv6, CIDR, IPv4-mapped, an empty list.
  - 50 signed-in users behind one IP, 500 requests against an IP limit of 100: none throttled.
  - One user over the per-user limit: 429.
  - Unauthenticated requests share the IP limit.
  - A flood of missing or bad tokens: 401 until the IP limit, then 429.
  - Forged `X-Forwarded-For` and `CF-Connecting-IP` from an untrusted address are ignored,
    including rotating forged values.
  - From a trusted proxy: `CF-Connecting-IP`, then `X-Forwarded-For` walked from the right; an
    invalid header falls back.
- **Matching unit (7):** canonical pairs, `decideMatch`, unmatch rules, cursors, flush batch
  sizes (500, 500, 201), one statement per batch then settle, the contributed filter.
- **Matching integration (10):**
  - The end-to-end flow: like, like back, `firstLikerId`, swiping an existing match, the list,
    unmatch idempotent with one event, no rematch, non-members get 404.
  - The same `swipeId` twice gives one row and the same answer.
  - Five concurrent likes from one user after a like back give one event.
  - `NOT_SERVED`, `NOT_FOUND` and `PROFILE_INCOMPLETE`.
  - The silent block: identical to a pass, nothing stored, no match.
  - A block ends an existing match (`unmatchedBy: null`).
  - The pass buffer: excluded from a deck built before the flush, then written, with the
    pending set cleared.
  - Retention across all 16 partitions, keeping likes and recent passes.
  - `likesIn` and export.
  - Account deletion removes swipes and anonymises the match in canonical order.
- **The invariant (1).**
- **Identity:** the rate-limit test now runs behind a trusted proxy, because the forwarded
  addresses it uses to tell clients apart are believed only from one (ADR 0015).

Mutation checks (each reverted afterwards):

| Mutation                                       | Result                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| No pair lock                                   | Invariant fails                                                  |
| `createOrGet` reports an existing match as new | Survived at first; caught after adding the concurrent-likes test |
| A blocked pair reveals itself (`BLOCKED`)      | 1 test fails                                                     |
| Buffered passes not excluded from decks        | 1 test fails                                                     |
| Rate limit keyed by IP only                    | 2 tests fail                                                     |
| Bad tokens rejected before the limiter         | 1 test fails                                                     |
| `CF-Connecting-IP` trusted from anyone         | 2 tests fail                                                     |
| Unmatch not persisted                          | 3 tests fail                                                     |

**Example requests and responses** (Docker image `vouch-api:phase8`, `ROLE=all`, 2,000-user
seed; no error logs; `docker stop --time 30` exits with code 0):

```
1) A likes B (B was served to A in A's deck)
> POST /v1/swipes {"swipeId":"de78b989-…","targetId":"EKV5zxME5wFi4L5ZQ5ir0w","direction":"like"}
< 200 {"matched":false,"matchId":null}

2) Same swipeId again (idempotent)
< 200 {"matched":false,"matchId":null}

3) B likes A back (A was served to B in B's deck)
> POST /v1/swipes {"swipeId":"eba991b0-…","targetId":"qWGwNjSL5txzESePzyo-jA","direction":"like"}
< 200 {"matched":true,"matchId":"01a201b9-3960-7918-9d12-f9722dc7b5cb"}

4) A lists matches
> GET /v1/matches?limit=5
< 200 {"items":[{"matchId":"01a201b9-…","conversationId":null,"user":{"userId":"EKV5zxME5wFi4L5ZQ5ir0w","name":"Meera","age":22,"photos":[4]}}],"nextCursor":null}

5) A passes someone else from the deck
< 200 {"matched":false,"matchId":null}

6) A likes someone never served
< 409 {"error":{"code":"NOT_SERVED",…}}

7) A unmatches                → 200 {"matchId":"01a201b9-…","unmatchedAt":"2026-11-22T05:27:25.834Z"}
8) A unmatches again          → 200 (the same body)
9) After the 5 s flush, the pass is in Postgres: [{"direction":0}]
```

Step 6's message was the bare code. I added readable messages for this phase's codes
afterwards (see the known issues).

**Decisions made:**

- [ADR 0015 — Global rate limit per user, and trusted proxies for the client IP](../adr/0015-rate-limit-keys-and-proxy-trust.md)
- [ADR 0016 — Exactly-once matches, silent blocks and batched passes](../adr/0016-matching-concurrency.md)

**Deviations from the roadmap:**

- **Two Phase 4 fixes first,** as you decided.
- **Authentication moved:** the 401 is now raised in `preValidation` instead of `onRequest`,
  so the limiter can count the request.
- **Passes go through a Redis buffer** and a flush job (your decision 1) rather than one job
  per pass. That adds two job contracts (`matching.flushPasses`, `matching.retentionTick`).
- **Matching contributes a deck filter** (`matching.excludeBufferedPasses`), the extension
  point from ARCHITECTURE.md 6.4. Discovery keeps `excludeSwiped`.
- **`profiles.api.isActive`** is new (additive), used by the swipe's `PROFILE_INCOMPLETE`
  check.
- **Invariant tests run on their own** (`pnpm test:invariants` and a CI step), so the timing
  target is measured without other suites' load.
- **The `BLOCKED` error code is no longer returned** by swipes (decision 5). It stays in the
  contracts, since contracts are additive.

**Known issues and risks:**

- **Missing readable messages (earlier phases).** These codes still return the bare code as
  their message: `UNKNOWN_SECTION_TYPE`, `PROFILE_INCOMPLETE`, `UNSUPPORTED_MEDIA_TYPE`,
  `FILE_TOO_LARGE`, `PHOTO_LIMIT_REACHED`, `UPLOAD_NOT_UPLOADED`, `MFA_REQUIRED`,
  `IP_NOT_ALLOWED` and `CONFLICT` (Phases 3–7). Per rule A.2, I didn't change that earlier
  code. Proposed fix: add their messages, plus a test that every contract error code has one.
- **The tail of the lock-hold times:** p99 is 18–23 ms locally. The target is p95, which is
  12–13 ms.
- **Buffered passes:** lost if Redis is wiped (accepted). A pass and a later like on the same
  pair resolve to whichever is written first: the like is synchronous, so usually the like.
- **Deleting a user's swipes** scans every partition, because there is no index on
  `target_id` for passes. That is fine at beta scale; revisit with real volumes.

**Suggested follow-ups (not done, need approval):**

1. The readable-messages fix above, with a test over every contract error code.
2. Phase 9: chat consumes `match.created.v1` and `match.unmatched.v1`; `listMatches` will fill
   `conversationId`.
3. Phase 15: set `TRUSTED_PROXIES` (recorded), and consider an index on
   `(target_id) WHERE direction = 0` if account deletions become slow.

**How you can check it yourself:**

```bash
cp .env.example .env && pnpm dev:keys --write && docker compose up -d --wait && pnpm db:migrate && pnpm db:seed && pnpm storage:init
```

```bash
pnpm test:invariants
```

```bash
pnpm --filter @vouch/api exec vitest run test/modules/matching test/platform/client-ip.test.js
```

**Pull request:** see the PR "Phase 8 — Matching module" · Branch: `claude/lucid-rubin-foq2uj`
(ADR 0002)
