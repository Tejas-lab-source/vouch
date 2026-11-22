# 0016 — Exactly-once matches, silent blocks and batched passes

- Status: Accepted (by owner on 2026-11-22, Phase 8 start plan)
- Phase: 8

## Context

Two people can like each other at the same instant. They must end up with exactly one match and
exactly one `match.created.v1`. The app runs behind a transaction pooler, so session-level locks
cannot be used. Passes are about 9 in 10 swipes and need not be written synchronously. A block
must never be revealed to the blocked person.

## Decision

- **Like transaction:** insert the swipe (`ON CONFLICT DO NOTHING`), take
  `pg_advisory_xact_lock` on the unordered pair (`lockPair`), re-check the block on the same
  transaction, look for the like back, and `INSERT … ON CONFLICT (user_low, user_high) DO
NOTHING` on the canonical pair. The event is emitted in the same transaction only when the
  insert created the row. Because each like is inserted before the lock, the second of two
  simultaneous likes always sees the first one after the lock, and the first never sees the
  second: exactly one transaction creates the match.
- **Unmatch is permanent:** a pair that was ever unmatched never matches again (likes are kept).
- **Silent block (owner decision):** a swipe on a blocked pair, in either direction, returns
  `{ matched: false, matchId: null }`, byte for byte the same as a pass, and stores nothing. A
  block that lands during a like rolls the like back.
- **Idempotency:** `swipeId` is the idempotency key (stored result replayed); a repeated swipe
  on the same pair is also a no-op in Postgres (the first swipe wins).
- **Pass batching (owner decision):** passes go to a Redis buffer and a per-swiper pending set;
  every 5 s (or at 500) they move into `matching.writePasses` jobs of up to 500, each one
  statement. A filter contributed to `discovery.candidateFilters` excludes pending passes, so a
  passed person cannot reappear before the flush. Losing buffered passes when Redis is wiped is
  accepted.
- **Deletion:** a deleted user's swipes are removed and their matches anonymised with a random
  tombstone id in canonical order, so the other person's history stays consistent.

## Alternatives considered

- **`SERIALIZABLE` transactions:** retries under contention, and more database work per like.
- **A unique constraint alone:** prevents two matches but not the race to emit the event twice.
- **Synchronous passes:** one write per pass on the hot path.

## Consequences

- Measured: 1,000 simultaneous pairs, 1,000 matches and 1,000 events; pair-lock hold p95
  13.2 ms (target under 20 ms).
- Passes reach Postgres up to about 5 s late.
