# Phase 14 performance report

- **Date:** 2026-11-23
- **Machine:** one 4-core, 15 GB container running everything: k6, the API, Postgres and
  Redis, in Docker Compose with CPU and memory limits. The load generator shares the machine,
  so absolute numbers are pessimistic; the comparisons between runs are what matter.
- **Kit:** `load/` (README there). Each run lasts 300 s after a 60 s ramp. The raw results
  are in `load/out/` and are not committed.
- **Data:** the 2,000-user seed (one campus cluster) plus 500 open conversations.

## Targets

| Load                  | Beta peak (1x) | 10x       |
| --------------------- | -------------- | --------- |
| HTTP                  | 47 req/s       | 470 req/s |
| Swipes (part of HTTP) | 12.5 /s        | 125 /s    |
| Connected sockets     | 600            | 6,000     |
| Chat messages         | 3.1 /s         | 31 /s     |

**Beta SLOs:**

- API p95 < 300 ms
- deck p95 < 250 ms
- message delivery p95 < 1 s
- push p95 < 30 s

**Beta plan, as assumed in `load/compose.yml`:**

- API: one `ROLE=all` process, 0.5 CPU and 512 MB (Render Starter)
- Postgres: 0.1 CPU and 256 MB (Basic-256mb)
- Redis: 256 MB

## Headline

1. **The beta plan cannot carry the beta peak.**
   - At 1x, Postgres (0.1 CPU) is saturated the whole time.
   - Route p95 is 2.6–7.9 s, 37% of requests fail, and most chat messages fail.
   - At 10x it serves about 5 req/s; everything else is refused.
   - **This needs your decision: a larger Postgres plan (see below).**
2. **With Postgres at 0.5 CPU and the API at 1 CPU, the beta peak meets every SLO.**
   - Route p95 25–45 ms, delivery p95 69 ms, no errors.
   - With the API still at 0.5 CPU, the peak is also served without errors, with chat
     delivery p95 146 ms. But HTTP p95 tails reach 0.6–1.3 s from CPU bursts.
3. **The code scales to 10x when given CPU.**
   - Measured with the API on 4 cores and Postgres on 2: 388 req/s served, all 6,000
     sockets, and message delivery p95 632 ms.
   - The limit there is the 10-connection database pool (see "Pool size").
4. **Fixed in Phase 14** (each with a test that failed before it):
   - **The API ran out of heap and crashed under overload.** Every socket dropped. It now
     sheds load (503 with `Retry-After`) and stays up.
   - **The deck worker allocated a timer per scorer per candidate.** The same load now uses
     a third less API CPU.

## Results

Latency per route is in ms (p50 / p95 / p99). "Failed" counts errors, 503s and timeouts at
k6's 60 s limit.

### 10x on the beta plan (the roadmap's test)

| Route             | p50 | p95 | p99    |
| ----------------- | --- | --- | ------ |
| getDeck           | 0.9 | 629 | 895    |
| swipe             | —   | —   | —      |
| getMyProfile      | 0.8 | 634 | 27,468 |
| listMatches       | 0.8 | 626 | 9,982  |
| listConversations | 0.8 | 632 | 16,549 |
| listMessages      | 0.8 | 634 | 15,004 |
| getConfig         | 0.8 | 638 | 1,677  |

- **HTTP:** 135,411 requests (347/s offered). **98.9% refused (503)** by overload
  protection, in under 1 ms. About 5 req/s were served.
- **Sockets:** 6,000 connected, and all stayed up.
- **Chat:** 10,756 sent. Ack p50 34.5 s and p95 41.6 s. 394 refused under pressure.
- **Process:** API CPU at its 0.5 limit (42% avg of one core in `docker stats`). Postgres at
  its 0.1 limit. Event-loop lag p99 123 ms avg, 605 ms max. RSS 278 MB avg, 305 MB max.
  Outbox lag 17.7 s max. Oldest waiting job in the `fast` queue 274 s.
- **Before the overload fix:** the same run ended with `FATAL ERROR: … JavaScript heap out
of memory` at 342 s. Every socket dropped, and k6 saw `dial: i/o timeout` from then on.

### 1x on the beta plan

| Route             | p50   | p95   | p99    |
| ----------------- | ----- | ----- | ------ |
| getDeck           | 1,666 | 7,532 | 8,645  |
| swipe             | 5,372 | 7,869 | 8,302  |
| getMyProfile      | 5,049 | 6,797 | 10,556 |
| listMatches       | 3,294 | 4,467 | 6,562  |
| listConversations | 3,269 | 4,521 | 7,208  |
| listMessages      | 3,465 | 6,613 | 10,246 |
| getLikesCount     | 1,513 | 2,669 | 3,909  |

- **HTTP:** 14,073 requests (38.6/s). **37% failed.**
- **Chat:** 488 sent. Ack p95 4.2 s, delivery p95 4.5 s. 300 refused.
- **Process:**
  - Postgres averaged 8.3% of a core against a 10% cap, so it was saturated.
  - The API averaged 20% of a core against a 50% cap.
  - Oldest waiting `fast` job: 117 s.

### 1x with Postgres at 0.5 CPU (API still 0.5 CPU)

| Route             | p50  | p95   | p99   |
| ----------------- | ---- | ----- | ----- |
| getDeck           | 20.8 | 1,249 | 1,836 |
| swipe             | 7.8  | 302   | 1,463 |
| getMyProfile      | 6.3  | 1,345 | 2,304 |
| listMatches       | 5.8  | 847   | 1,539 |
| listConversations | 6.4  | 908   | 1,670 |
| listMessages      | 6.1  | 1,304 | 2,293 |
| getLikesCount     | 6.2  | 582   | 1,043 |

- **HTTP:** 14,176 requests (39.3/s). **0 failed.**
- **Chat:** 438 sent, 438 delivered. Ack p95 141 ms, **delivery p95 146 ms** (SLO met).
- **Process:**
  - Postgres averaged 9.9% of a core, with headroom to 50%.
  - API CPU averaged 22% of a core, with bursts to its 50% cap. Event-loop lag p99 averaged
    77 ms and reached 399 ms: the deck worker ranks about 340 candidates in the same process.
  - Outbox lag 1.7 s max. Oldest waiting `fast` job 7.2 s.
- **SLOs:** chat is met. API p95 and deck p95 are not: tails of 0.6–1.3 s come from API CPU
  bursts.

### 1x on the recommended plan (API 1 CPU, Postgres 0.5 CPU) — every SLO met

| Route             | p50 | p95  | p99  |
| ----------------- | --- | ---- | ---- |
| getDeck           | 7.3 | 44.9 | 81.0 |
| swipe             | 7.2 | 28.5 | 75.0 |
| getMyProfile      | 5.6 | 30.9 | 68.6 |
| listMatches       | 5.0 | 31.1 | 73.3 |
| listConversations | 5.8 | 36.6 | 82.7 |
| listMessages      | 5.5 | 32.2 | 80.8 |
| getConfig         | 4.7 | 29.8 | 80.8 |
| getLikesCount     | 5.6 | 25.8 | 70.9 |

- **HTTP:** 14,177 requests (39.4/s). **0 failed.**
- **Chat:** 488 sent, 488 delivered. **Delivery p95 69 ms**, ack p95 69 ms.
- **Process:**
  - API CPU averaged 21% of a core (max 70%, under its 100% cap). Event-loop lag p99 27 ms
    avg, 79 ms max.
  - Postgres averaged 9.4% of a core (max 23%, cap 50%).
  - Outbox lag 1.7 s max. No queue backlog.
- **SLOs:**
  - API p95 under 300 ms: met (25–37 ms)
  - deck p95 under 250 ms: met (45 ms)
  - message delivery p95 under 1 s: met (69 ms)
  - push p95 under 30 s: not measured end to end. Pushes go to the console provider in this
    test; the notification consumer kept up (no queue backlog).

### 10x with no CPU limits (API 4 cores, Postgres 2, Redis 1)

| Route             | p50 | p95 | p99   |
| ----------------- | --- | --- | ----- |
| getDeck           | 259 | 897 | 1,251 |
| swipe             | 323 | 747 | 1,072 |
| getMyProfile      | 289 | 732 | 1,004 |
| listMatches       | 193 | 502 | 702   |
| listConversations | 194 | 503 | 705   |
| listMessages      | 196 | 511 | 718   |
| getLikesCount     | 103 | 271 | 413   |

- **HTTP:** 140,201 requests (388/s served). **20.5% refused** by the in-flight cap.
- **Sockets:** 6,000 connected, 0 errors.
- **Chat:** 10,758 sent and all acknowledged. Ack p95 623 ms, **delivery p95 632 ms**.
- **Process:**
  - API CPU 1.1 cores avg (1.7 max). Postgres 0.5 cores avg (0.85 max). Redis 0.1.
  - Event-loop lag p99 31 ms avg. RSS 329 MB avg, 361 MB max.
  - Outbox lag 1.9 s max. Oldest waiting `fast` job 26 s.
- **The limit is not CPU.** The API and Postgres have spare cores, and the event loop is
  idle. Requests wait for one of the 10 pooled database connections, and each module read
  is four round trips (`BEGIN`, `SET LOCAL ROLE`, the query, `COMMIT`). See "Pool size".

### 10x, no CPU limits, a 30-connection pool (inconclusive)

- **Result:** 68% failed, and jobs reached the dead-letter queues.
- **Why:** this run's Postgres allowed only `max_connections=50`. With 30 connections for
  the API plus the queue workers' and admin connections, it ran out of connections. The
  result says nothing about pool size; it shows that the pool must stay within the
  database's connection limit.
- **Setting:** `DATABASE_POOL_MAX` stays 10, and the deploy (Phase 15) sizes it to the
  chosen plan.

## Chaos

Chaos runs at the beta peak (1x) on the recommended plan. The kit is `CHAOS=1 load/run.sh`:

- At 90 s it SIGKILLs the API container (in the beta one process is the API, the gateway
  and the worker).
- At 150 s it SIGKILLs Redis for 10 s.

| Fault                                      | Recovery                                            | During the fault                                                                                   |
| ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| API process killed (`docker kill -s KILL`) | `/ready` again **2.35 s** after the restart started | Requests in flight failed; clients' sockets reconnected                                            |
| Redis killed for 10 s                      | `/ready` again **1.5 s** after Redis was back       | `/ready` reports Redis down; rate limiting fails open; OTP, admin sign-in and presigns fail closed |

- **Over the whole 300 s run:**
  - 3.3% of requests failed, all during the two faults
  - 300 messages sent; **all 300 acknowledged, stored and delivered**
  - the outbox drained to 0 after recovery
- **The same chaos on the beta plan** (Postgres 0.1 CPU) was not informative, because the
  plan was already saturated at 1x. `/ready` took 277 s to answer within its probe timeout
  after the restart, and every message failed before the faults.

- **Gateway killed mid-stream** (`test/invariants/chat-gateway-failover.test.js`, separate
  `ROLE=ws` processes): 200 messages, gateway A killed with SIGKILL after 60 acks. Both
  clients move to gateway B and resync: 200/200 stored, no gap, no duplicate seq.
- **Worker killed mid-burst** (`test/invariants/worker-kill.test.js`, new): 40 matches and
  60 messages, the worker killed with SIGKILL after 8 conversations.
  - All 60 acknowledged messages are stored.
  - All 40 `match.created` events are processed exactly once by each consumer (chat,
    discovery, notifications).
  - A job the killed worker held is redelivered when its queue lock expires.
  - Chat's `openConversation` commits in its own transaction before the consumer's inbox
    row. If the worker dies between the two, the conversation exists while the event is
    redelivered; the idempotent handler then records it. Nothing is lost.

## Top 10 queries (`EXPLAIN ANALYZE`)

These are the top 10 by total time from `pg_stat_statements` in the 1x beta-plan run. Each
was explained on that database (0.1 CPU, after the run), as its module's role. The full
plans are produced by `load/explain.sh`.

| #   | Query                                     | Plan                                                                                                                                        | Execution | Planning |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- |
| 1   | Deck candidates (`profiles.candidates_v`) | Bitmap index `profiles_candidates` (cluster, gender) → 339 rows; anti-joins on `seen_v` (partition-pruned) and `block_pairs_v` (index-only) | 96 ms*    | 93 ms*   |
| 2   | Deck viewer                               | Primary keys                                                                                                                                | 0.4 ms    | 1.7 ms   |
| 3   | Users by ids                              | `users_pkey`                                                                                                                                | 0.14 ms   | 1.7 ms   |
| 4   | User by id                                | `users_pkey`                                                                                                                                | 0.13 ms   | 1.8 ms   |
| 5   | Conversation list                         | Seq scan on 500 conversations (both member columns are indexed; Postgres switches as the table grows); last message by primary key          | 0.5 ms    | 102 ms*  |
| 6   | Colleges by ids                           | Primary key                                                                                                                                 | 0.05 ms   | 1.4 ms   |
| 7   | Profile sections                          | `profile_sections` primary key                                                                                                              | 0.11 ms   | 1.2 ms   |
| 8   | Seen among (`matching.seen_v`)            | Partition-pruned primary key                                                                                                                | 0.05 ms   | 93 ms*   |
| 9   | Likes count                               | `swipes_target` index plus anti-joins                                                                                                       | 0.6 ms    | 102 ms*  |
| 10  | Message history                           | Partition-pruned primary key                                                                                                                | 0.07 ms   | 1.6 ms   |

\* At 0.1 CPU the kernel throttles Postgres to 10 ms of CPU per 100 ms, so anything over
about 10 ms of CPU is stretched about tenfold. Notes on the starred rows:

- **Query 1:** executed in 3.9 ms and planned in about 10 ms in an earlier, less throttled
  run.
- **Planning:** queries over the 16-way hash-partitioned tables (`chat.messages`,
  `matching.swipes`) are planned about 50x slower than the others. In the app these are
  prepared statements, so a cached plan is reused per connection after the first runs.
- **Query 1's remaining cost:** the approved-photos count subquery runs once per candidate.
- **No missing indexes.** Every plan uses the intended index or partition pruning.
- **The fix is CPU, not SQL.** Every query but the deck's executes in under 1 ms of real
  time.

## Gateway memory per socket (owner task 4)

Measured by `test/invariants/socket-memory.test.js`:

- **Setup:** 600 idle sockets on a gateway in its own process, so the clients' memory is not
  counted. The minimum of 8 samples after the heap settles.

| Configuration                               | RSS per idle socket | Heap per idle socket |
| ------------------------------------------- | ------------------- | -------------------- |
| Before (Socket.IO defaults)                 | 51 KB               | ~0 (noise)           |
| After (16 KB message limit, no compression) | 53–59 KB            | ~0–27 KB             |

- **Target:** under 100 KB per idle socket. **Met before and after.**
- **The Phase 9 figure** (about 0.8 MB per socket) was RSS _under load_, not retained state:
  the load smoke's in-flight messages and the heap's high-water mark. RSS does not shrink
  after a peak.
- **At 6,000 sockets under 10x load:**
  - unlimited run: RSS reached 361 MB
  - beta plan: 305 MB
- **Per-message compression** (`perMessageDeflate`) costs hundreds of KB per socket in zlib
  state. It is now pinned off, and was already off by default.
- **The 512 MB API:** holds 6,000 sockets at 10x, with V8 now allowed 75% of the container.
  Before that, at about 50%, it ran out of heap.

## CPU profile and fixes

**The profile:** API CPU under a 1x load, unlimited, 60 s, `--cpu-prof`.

- 81% idle.
- Of the busy time, garbage collection was about 30%. The deck worker caused most of it:
  for each of about 340 candidates per build, each scorer step was wrapped in a promise race
  with a timer.
- Then socket writes, the Postgres driver, and Fastify.

**Fix: synchronous pipeline steps run directly.** A synchronous step cannot be timed out (it
holds the event loop until it returns), so only promises get the timer.

- **Result:** API CPU for the same run fell from 32% to 21% of a core.
- **Test:** `test/platform/pipelines.test.js`, "synchronous steps run without a timer".

**Fix: overload protection** (`apps/api/src/platform/pressure.js` and `http.js`).

- **When new requests get 503 with `Retry-After`:**
  - the mean event-loop delay is over 250 ms per second
  - the heap is over 85% of V8's limit
  - 128 requests are already in progress (the database-bound case)
- New sockets are refused under the same conditions.
- Health checks are never shed. Each refusal is counted in `vouch_shed_total{kind,reason}`.
- The image runs Node with `--max-old-space-size-percentage=75`.
- **Tests:** `test/platform/pressure.test.js`. The cap and the 503 tests fail on the old code.

## Pool size

- **The pool is 10 connections** (`DATABASE_POOL_MAX`). A module read is four round trips
  (`BEGIN`, `SET LOCAL ROLE`, the query, `COMMIT`). Writes add the outbox insert.
- **At 10x on large CPUs, the pool is the ceiling:**
  - 128 requests in flight wait for 10 connections
  - API and Postgres CPU stay well below their limits
  - the in-flight cap sheds the rest
- **The pool can only grow within the database plan's connection limit,** as the 30-connection
  run showed. With 50 connections, it failed.
- **For growth (not the beta):**
  - more API processes (the roles already split: `api`, `ws`, `worker`)
  - a transaction pooler in front of Postgres (the db layer supports `prepare: false`)
  - fewer round trips per read, by folding the role preamble into the query batch

## Recommendations (need your decision)

1. **Postgres: at least 0.5 CPU for the beta** (for example Render Basic-1gb instead of
   Basic-256mb).
   - At 0.1 CPU the database saturates at the beta peak itself (1x).
   - At 0.5 CPU it serves 1x with headroom (9–10% average use).
   - This changes the beta cost; it is your decision.
2. **API: 1 CPU** (for example Render Standard instead of Starter) if you want the API and
   deck p95 SLOs met at the peak.
   - With 0.5 CPU, chat SLOs are met but HTTP p95 tails reach 0.6–1.3 s. The deck worker
     runs in the same process and bursts the CPU.
   - The alternative is to keep 0.5 CPU and accept slower tails at peak minutes only.
3. **10x is beyond one process by design** (ARCHITECTURE: split roles before 10x).
   - The code handles 10x with 4 API cores and 2 Postgres cores, apart from the pool limit.
   - Splitting `ws` and `worker` into their own processes is the Phase 15 or later step, if
     growth needs it.
4. **Overload protection now keeps the API up.** Under overload it answers 503 quickly
   rather than crashing. The thresholds are env settings and can be tuned after real
   traffic:
   - `PRESSURE_MAX_IN_FLIGHT` (128)
   - `PRESSURE_MAX_EVENT_LOOP_DELAY_MS` (250)
   - `PRESSURE_MAX_HEAP_RATIO` (0.85)
