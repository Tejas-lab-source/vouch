# 0008 — Event bus: transactional outbox, per-consumer queues and an inbox

- Status: Accepted (by owner on 2026-11-21, Phase 4 start plan)
- Phase: 4

## Context

Modules must react to each other's changes (a match opens a conversation, a block purges
decks) without calling each other synchronously and without losing or duplicating effects when a
process crashes. Redis is disposable state (ARCHITECTURE.md 2.4), so events cannot live only in
a queue.

## Decision

- **Outbox:** a use case calls `emit(event, payload)` inside `uow.run`. The payload is validated
  against the event contract and inserted into `platform.outbox` in the same transaction as the
  business change, with the current trace id. Both commit, or neither does.
- **Relay** (`platform/events/relay.js`, worker role):
  - It selects up to 200 unpublished rows with `FOR UPDATE SKIP LOCKED`, so several relays can
    run at once without publishing twice.
  - It adds one job per subscribing module to `evt.<module>`, with job id `<module>-<outboxId>`
    (BullMQ refuses `:` in custom ids), then marks the rows published.
  - It polls every 200 ms while busy and every 2 s when idle.
  - Routing uses the full event name, which already ends in `.vN`.
- **Consumer** (`platform/events/consume.js`): validates the envelope, then runs
  `INSERT INTO platform.inbox (consumer, event_id) … ON CONFLICT DO NOTHING` and the handler in
  one transaction as the consumer's role. A redelivery finds the row and is a no-op. A handler
  failure rolls back the inbox row, so a retry runs it again.
- **Failures:** consumers retry with exponential backoff and full jitter (8 attempts), then the
  job is copied to `dlq.evt.<module>`. Each consumer has its own queue, so one failing consumer
  never blocks another.
- **Retention:** a nightly scheduled tick (03:17 UTC, run once across workers) deletes published
  outbox rows after 7 days and inbox rows after 30 days, in batches of 5,000.

## Alternatives considered

- **Enqueue BullMQ jobs directly from use cases:** lost events when Redis or the process fails
  between the commit and the enqueue.
- **Postgres LISTEN/NOTIFY:** no retries, no dead letters, and messages are lost while no
  listener is connected.
- **Kafka or a hosted bus:** far beyond beta scale and budget (ARCHITECTURE.md ADR-3).

## Consequences

- Delivery is at least once; handlers with external side effects (push, email) use the event id
  as the provider's idempotency key where possible.
- Latency is the relay interval. Measured locally: about 185 ms p50/p95 while busy, and up to
  about 2 s for the first event after an idle period.
- Consumers must tolerate reordering, since relays and workers run in parallel.
- Module roles hold `INSERT` and a column-level `SELECT (id)` on `platform.outbox` (for
  `RETURNING id`), never `SELECT` on payloads.
