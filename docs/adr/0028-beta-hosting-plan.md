# 0028 — Beta hosting plan: Postgres Basic-1gb, API Standard, Key Value Starter

- Status: Accepted (by owner on 2026-11-23, after the Phase 14 report)
- Phase: 14 (decision), applied in Phase 15

## Context

ARCHITECTURE §3.5 assumed a smaller beta plan:

- one `ROLE=all` process on Render Starter (0.5 CPU, 512 MB)
- Postgres Basic-256mb (0.1 CPU, 256 MB)
- Render Key Value

The Phase 14 load test ran that plan on Docker Compose with the same CPU and memory limits
(`load/`, `docs/performance/phase-14-report.md`). **The assumed plan fails at the beta peak
itself (1x):** 47 req/s, 600 sockets, 3.1 messages/s.

| Setup at the beta peak (1x)                     | Failed | HTTP p95     | Deck p95  | Message delivery p95 |
| ----------------------------------------------- | ------ | ------------ | --------- | -------------------- |
| API 0.5 CPU, Postgres 0.1 CPU (assumed plan)    | 37%    | 2.7–7.9 s    | 7.5 s     | 4.5 s                |
| API 0.5 CPU, Postgres 0.5 CPU                   | 0%     | 0.3–1.3 s    | 1.2 s     | 146 ms               |
| **API 1 CPU, Postgres 0.5 CPU (this decision)** | **0%** | **26–37 ms** | **45 ms** | **69 ms**            |

- **At 0.1 CPU, Postgres** was saturated for the whole run.
- **At 0.5 CPU, Postgres** averaged 9–10% of a core: about 5x headroom.
- **With a 0.5-CPU API**, the deck worker (which runs in the same process) caused CPU bursts
  that pushed HTTP p95 tails past the 300 ms SLO. With 1 CPU, the API averaged 21% of a core
  (max 70%), and event-loop lag p99 stayed under 80 ms.

## Decision

| Component | Plan                         | Resources (as measured)             |
| --------- | ---------------------------- | ----------------------------------- |
| API       | Render web service, Standard | 1 CPU, 2 GB; one `ROLE=all` process |
| Postgres  | Render Postgres, Basic-1gb   | 0.5 CPU, 1 GB                       |
| Redis     | Render Key Value, Starter    | persistence off                     |

- **Staging** uses the smallest plans. It runs a synthetic seed only and has no SLO.
- **The application settings stay as measured:**
  - `DATABASE_POOL_MAX` 10, within Basic-1gb's connection limit
  - overload protection: `PRESSURE_*` defaults
  - V8 gets 75% of the container
- **Stepping the API down to Starter later** (0.5 CPU, 512 MB) is allowed when production
  metrics show headroom. All of these must hold over a representative week of peak traffic:
  - API CPU under 40% of 1 CPU at peak
  - event-loop lag p99 under 100 ms
  - HTTP p95 under 150 ms
  - no 503 sheds (`vouch_shed_total`)
  - memory under 400 MB

  The owner decides. A step-down is a dashboard change, followed by a 1x re-check with
  `LOAD_API_CPUS=0.5 load/run.sh 300 0.1`.

## Alternatives considered

- **The assumed plan:** it fails the beta peak (above).
- **Neon Launch at 0.25 CU:** not measured. Its CPU is between the two Postgres sizes tested,
  and it scales to zero only when idle, which the outbox relay prevents.
- **A 0.5-CPU API:** chat SLOs are met, but HTTP p95 tails reach 0.6–1.3 s at peak minutes.
  This remains the step-down option above.

## Consequences

- **Cost:** the monthly cost is above the roadmap's $25–40 estimate. Render's list prices
  are about $25 (Standard) + $19 (Basic-1gb) + $10 (Key Value Starter) = about $54 a month
  for production, plus staging. The Phase 15 report gives the actual billed figures.
- **10x the beta peak** needs more than one process, which is expected (ARCHITECTURE: split
  roles before 10x). The measured ceiling is the database pool, not CPU.
- **Approved post-launch follow-up:** shed or limit socket message load under overload, the
  way HTTP already returns a quick 503 (PROGRESS, "Notes for later phases").
