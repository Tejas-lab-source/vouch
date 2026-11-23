# Load test (Phase 14)

10x the beta peak against the beta plan's resources, on one machine with Docker Compose.

| Traffic           | Beta peak (1x) | This test (10x) |
| ----------------- | -------------- | --------------- |
| HTTP requests     | 47 req/s       | 470 req/s       |
| Swipes (in HTTP)  | 12.5 /s        | 125 /s          |
| Connected sockets | 600            | 6,000           |
| Chat messages     | 3.1 /s         | 31 /s           |

```bash
load/run.sh [duration_s=300] [scale=1]
```

- `scale` 0.1 is the beta peak itself.
- Needs Docker, Node 24, and the API image `vouch-api:load`
  (`docker build -t vouch-api:load .`, or `LOAD_API_IMAGE=…`).
- `CHAOS=1` kills the API (API, gateway and worker: one process in the beta), then Redis, and
  times each recovery.
- `LOAD_API_CPUS`, `LOAD_PG_CPUS` and `LOAD_REDIS_CPUS` override the beta plan's CPU limits,
  to measure what each service needs.
- `KEEP_STACK=1` leaves the stack up, for `EXPLAIN ANALYZE`.

**Results** go to `load/out/` (git-ignored):

- `summary.json`: k6, with latency per route and chat ack and delivery
- `samples.jsonl`: every 5 s, CPU and memory per container, event-loop lag, outbox lag and
  backlog, and the oldest waiting job per queue
- `top-queries.tsv`: `pg_stat_statements`, the top 10 by total time
- `chaos.jsonl`: chaos runs only

**Parts:**

- `compose.yml`: Postgres, Redis and the API, with the beta plan's limits
- `k6/beta-10x.js`: the scenarios. Socket.IO is spoken over a raw WebSocket (engine.io v4),
  with reconnects.
- `sample.js`: the sampler
- `../apps/api/scripts/load-prepare.js`: seeds 2,000 users and 500 open conversations, and
  signs tokens with this run's throwaway keys

**Notes:**

- The API runs with `NODE_ENV=development`, because production refuses the console and dev
  providers (no real email, push or moderation calls).
- Rate limits are raised, so capacity is measured rather than the limiter.

The results and their analysis are in `docs/performance/phase-14-report.md`.
