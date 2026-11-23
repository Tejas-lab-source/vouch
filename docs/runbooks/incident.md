# Runbook: incident response

For anything that breaks the service or puts users at risk. A personal-data breach also
follows `breach.md`, which has a legal clock.

## Severity

| Level | Examples                                                                                             | Response                               |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| SEV-1 | Data breach; the whole app down; messages lost; a blocked user can reach the person who blocked them | Immediately, all hands, owner informed |
| SEV-2 | A core flow broken (sign-in, swiping, chat, push) for many users; error rate above 2% for 5 minutes  | Within 30 minutes                      |
| SEV-3 | A degraded or minor feature; a slow route; a single college affected                                 | Next working day                       |

## 1. Declare

- Name an incident lead and a scribe (one person can do both in the beta).
- Start a timeline in UTC: what was seen, what was done, and by whom.
- For SEV-1 and SEV-2, post a short status ("We are investigating problems with X") in the
  app's status channel. A configuration flag can show a banner.

## 2. Diagnose

Check, in this order:

1. **`GET /ready` and the host dashboard.** Is the process up? Is it restarting?
   - What memory is it using (512 MB limit)?
   - What is the event-loop lag (`nodejs_eventloop_lag_p99_seconds`)?
2. **Postgres.**
   - CPU (0.1 CPU in the beta: the first thing to saturate, see the Phase 14 report)
   - connections (`pg_stat_activity`) and long queries
   - `SELECT count(*) FROM platform.outbox WHERE published_at IS NULL` (outbox backlog)
3. **Redis.** Memory, and whether it is reachable. Without Redis:
   - the global rate limiter fails open
   - OTP, admin sign-in and presigns fail closed
   - sockets cannot fan out across processes
4. **Queues.**
   - BullMQ waiting and failed counts, per queue
   - dead letters: the events a consumer gave up on (they are retried with backoff first)
5. **Recent changes.** The last deploy, flag changes (admin audit log `flag.put`), and
   provider status pages.

## 3. Mitigate

Mitigate before you fix the root cause:

- **Bad deploy:** promote the previous image.
- **Overload:** scale the instance up. Lower expensive limits with flags.
  `RATE_LIMIT_*` can be tightened through the environment.
- **A feature misbehaving:** turn its flag off (`PUT /v1/admin/flags/{key}`, audited).
- **Stuck consumers:** restart the process. Events wait safely in the outbox and queues, and
  are processed once (inbox), see the Phase 14 worker-kill invariant.
- **Redis lost:** restart it. The app reconnects by itself (Phase 14 chaos test). Sessions
  are unaffected, and presence and caches rebuild.
- **Postgres lost:** follow `restore.md`.

## 4. Close

- Confirm the fix against the symptom and the SLOs: API p95 < 300 ms, deck p95 < 250 ms,
  delivery p95 < 1 s, push p95 < 30 s.
- Within 5 working days (SEV-1 and SEV-2): a blameless review with the timeline, cause,
  impact (users, duration), and actions with owners and dates.
