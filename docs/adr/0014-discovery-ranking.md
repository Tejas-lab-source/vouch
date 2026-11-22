# 0014 — Discovery: precomputed decks and hand-tuned ranking

- Status: Accepted (by owner on 2026-11-22, Phase 7 start plan)
- Phase: 7

## Context

Users swipe through a deck of eligible students from their campus cluster. The deck read must
stay fast (p95 under 250 ms) and never compute rankings on the request path, a stale deck must
never show someone who was blocked, and ranking should be explainable now and replaceable by a
learned model later (ARCHITECTURE.md 8.5).

## Decision

- **Precomputed decks:** a worker (`discovery.buildDeck`, queue `fast`, job id `deck-{uid}`,
  because BullMQ ids cannot contain `:`) builds the top 50 ids into `discovery:deck:{uid}` (24 h).
  Finished jobs are removed at once, so the id deduplicates only while a build is waiting or
  running. The read path pops 10, re-checks blocks and bans, hydrates cards, records them as
  served, emits one `deck.served.v1` per page, and queues a refill below 20. With no deck it
  queues a build and returns `cards: []`. The first deck is built when a profile becomes active.
- **Candidate source:** one SQL query over the published views, in the viewer's cluster only,
  with mutual preferences and the swipe, block and active-account exclusions; up to 500 ids;
  on `DATABASE_REPLICA_URL` when set (`db.read(..., { replica: true })`).
- **Pipelines:** discovery owns `discovery.candidateFilters` and `discovery.scorers`, and adds
  every v1 step itself, as the roadmap says (ARCHITECTURE.md 6.4 has matching and safety
  contributing some; Phase 8 may move `excludeSwiped` to matching). Filters run on the same
  input and their removals are combined; a failed or slow filter is skipped (fail open), which
  is safe because the SQL applies the same exclusions and the read path re-checks blocks.
  Filters that query get 250 ms (worker path only); scorers keep the 50 ms default.
- **Ranking (`HandTunedRanker` behind the `Ranker` port):**
  total = exposure gate × (base + Σ weight × score). Owner defaults, all `DISCOVERY_*`:

  | Scorer       | Score                                 | Weight |
  | ------------ | ------------------------------------- | ------ |
  | base         | 1                                     | 0.25   |
  | recency      | halves every 72 h since last active   | 0.35   |
  | completeness | approved photos / 6                   | 0.15   |
  | newUser      | 1 at sign-up, fading to 0 over 7 days | 0.25   |
  | exposureCap  | gate: 0 once shown 300 times today    | —      |

  The first 10 slots are diversified greedily: no two cards in a row from the same college
  when another candidate fits (`Candidate.collegeId`, additive), and at most 3 boosted new
  users. Each candidate's scorer reasons are logged at debug level.

- **Block invariant:** a block is written to Redis (`safety:blocked:{uid}`, both users) before
  its transaction commits and fails if Redis is down; a cached set is trusted only once loaded
  from Postgres (a marker member); the read path checks every popped id; and the
  `user.blocked.v1` consumer removes the pair from both decks.

## Alternatives considered

- **Ranking on the request path:** simpler, but 500 candidates × 4 scorers on every page would
  miss the latency target at scale.
- **A learned ranker now:** no impression data yet; `deck.served.v1` collects it for later.
- **Trusting any cached block set:** a wiped or partial Redis set would say "not blocked".

## Consequences

- A new user's first deck request returns no cards until the worker has built one (usually
  under a second); clients retry.
- Decks can lag profile changes by up to one rebuild; anyone who stops being showable is
  dropped at read time anyway.
- Measured: deck p95 117–135 ms at 10 concurrent requests and 22 ms at 1, over 1,000 requests
  with the 2,000-user seed, `ROLE=all` (Phase 7 report).
