# 0005 — Hash-partition swipes and messages from the first migration

- Status: Accepted (by owner on 2026-11-21, Phase 2 start plan)
- Phase: 2

## Context

`matching.swipes` and `chat.messages` are the two tables that grow fastest (about 625 swipes/s
and 156 messages/s at the 1M-user design target, roadmap B.7). Converting a large live table to
a partitioned one later is effectively a rewrite with downtime (`docs/ARCHITECTURE.md` ADR-4).

## Decision

- `matching.swipes` is `PARTITION BY HASH (swiper_id)` and `chat.messages` is
  `PARTITION BY HASH (conversation_id)`, each with 16 partitions (`swipes_p0…p15`,
  `messages_p0…p15`) created in the first migration.
- Partition keys sit inside the primary keys, as Postgres requires for unique constraints on
  partitioned tables: `(swiper_id, target_id)`, `(conversation_id, seq)` and
  `(conversation_id, client_msg_id)`.
- Every hot read filters by the partition key, so the planner prunes to one partition (verified
  with `EXPLAIN` in `apps/api/test/db/partitions.test.js`).
- `swipes.direction` is `1` for a like and `0` for a pass. Pass retention (30 days) runs partition
  by partition using the partial index `(created_at) WHERE direction = 0`.

## Alternatives considered

- **No partitioning until needed:** cheapest today, but the later conversion is the expensive
  part.
- **Range partitioning by time:** makes retention trivial, but the hot lookups are by swiper and
  conversation, which would then touch every time partition.
- **More partitions (64+):** more planning overhead and files at beta scale, for no benefit yet.

## Consequences

- No unique constraint can exist on a partitioned table without the partition key, so
  `chat.messages` has no standalone message id. The client-facing message id is defined in
  Phase 3 contracts (for example from `client_msg_id`).
- Queries that do not filter by the partition key (for example "all likes received by X")
  touch all 16 partitions; they rely on the partial index and are not on the request path.
- 16 hash partitions can later be split further by re-partitioning offline, one partition at a
  time.
