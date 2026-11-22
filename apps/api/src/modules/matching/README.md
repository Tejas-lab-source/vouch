# matching

Swipes, and matches created exactly once per pair (ADR 0016). Unmatch is permanent. Passes are
written in batches and expire after 30 days; likes are kept for the account's lifetime.

## Public API (`api.js`)

| Function            | Returns                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `areMatched(a, b)`  | Whether the two users have an active match                                  |
| `getMatch(matchId)` | `{ id, userLow, userHigh, createdAt, unmatchedAt, anonymisedAt }` or `null` |
| `likesIn(userId)`   | How many people liked the user and are still unanswered (a count only)      |

`likesIn` never exposes who (a later premium feature). Its route, `GET /v1/me/likes/count`,
arrives in Phase 12.

## HTTP routes (contracts in `packages/contracts/src/http/matching.js`)

| Route                           | Auth | Use case                                                                                                      |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `POST /v1/swipes`               | user | `swipe`: idempotent on `swipeId`; like or pass a served card                                                  |
| `GET /v1/matches`               | user | `listMatches`: active matches, newest first, cursor-paginated (`conversationId` equals the match id, Phase 9) |
| `POST /v1/matches/{id}/unmatch` | user | `unmatch`: permanent and idempotent; members only (`NOT_FOUND`)                                               |

### Swipe rules

1. Unknown or deleted target: `NOT_FOUND`. Swiping yourself: `VALIDATION_FAILED`. Caller's
   profile not active: `PROFILE_INCOMPLETE`.
2. **A blocked pair (either direction) is never revealed:** the answer is
   `{ matched: false, matchId: null }`, exactly as for a pass, and nothing is stored.
3. An existing active match: `{ matched: true, matchId }`.
4. The target must have been served to the caller (`discovery.api.wasServed`): `NOT_SERVED`.
5. **Like:** one transaction inserts the like, takes the pair lock
   (`pg_advisory_xact_lock`), re-checks the block on the same transaction, looks for the like
   back, and creates the match with `ON CONFLICT DO NOTHING` on the canonical pair. Only a new
   match emits `match.created.v1`. A pair that was ever unmatched never matches again.
6. **Pass:** buffered in Redis and answered at once; written within about 5 s.

## Pass batching

- A pass is pushed to `matching:passes:buffer` and its target is added to
  `matching:passes:pending:{swiperId}` (1 h TTL).
- `matching.flushPasses` (every 5 s, or at once when the buffer reaches 500) moves up to 500
  passes per `matching.writePasses` job; each job inserts its batch in one statement, dropping
  passes by or for accounts that are no longer active, then clears the pending entries.
- Matching contributes `matching.excludeBufferedPasses` to `discovery.candidateFilters`, so a
  deck built before the flush still excludes the people the viewer just passed.
- If Redis is wiped, buffered passes are lost (owner decision): those people may reappear.

## Events

- **Emits:** `match.created.v1` (once per pair), `match.unmatched.v1` (once per match;
  `unmatchedBy` is null for a block or deletion).
- **Consumes:** `user.blocked.v1` (ends an active match between the pair), `user.deleted.v1`
  (deletes the user's swipes in both directions, ends active matches, and anonymises every
  match: the user's id becomes a random tombstone, in canonical order).

## Jobs (queue `bulk`)

- `matching.flushPasses` (every 5 s), `matching.writePasses`.
- `matching.retentionTick` (nightly, 03:23 UTC) queues `matching.purgePasses` for each of the
  16 partitions; each deletes passes older than 30 days in batches of 5,000.

## Tables owned (schema `matching`)

`swipes` (hash-partitioned by swiper, 16 partitions; direction 1 = like, 0 = pass), `matches`
(canonical pair, unique). Views: `matching.seen_v`, `matching.likes_in_v`.

## Export

The user's swipes and matches, with public ids only (`null` for an anonymised match).
