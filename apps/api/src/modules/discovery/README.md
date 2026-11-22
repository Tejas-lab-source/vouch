# discovery

Ranked decks of eligible candidates from the viewer's campus cluster. Decks are precomputed by
a worker, kept in Redis and served from there; they are never computed on the request path.
No tables of its own: it reads published views (ADR 0014).

## Public API (`api.js`)

| Function                        | Returns                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `nextCards(viewerId)`           | `{ cards }`: the next page of up to 10 `ProfileCard`s                  |
| `wasServed(viewerId, targetId)` | Whether the target was served in the last 24 hours (matching, Phase 8) |

## HTTP routes

| Route          | Auth | Use case                                                     |
| -------------- | ---- | ------------------------------------------------------------ |
| `GET /v1/deck` | user | `getDeck`; `PROFILE_INCOMPLETE` unless the profile is active |

## Read path

1. Pop 10 ids from `discovery:deck:{uid}`. No deck yet: queue a build and return `cards: []`.
2. Drop blocked (`safety.blockPolicy`) and banned (`safety.bannedAmong`) users; hydrate through
   `profiles.api.getCards`, which skips anyone no longer active or deleted. One more pop fills
   the page if ids were dropped.
3. Add the shown ids to `discovery:served:{uid}`, count their exposure, and emit one
   `deck.served.v1` for the page.
4. Queue a refill when fewer than 20 remain.

## Deck worker (job `discovery.buildDeck`, queue `fast`, job id `deck-{uid}`)

1. **Candidate source** (SQL, replica when `DATABASE_REPLICA_URL` is set): up to 500 active
   people in the viewer's cluster only, with mutual gender and age preferences, not swiped
   (`matching.seen_v`), not blocked (`safety.block_pairs_v`), active accounts only
   (`identity.active_users_v`), most recently active first.
2. **`discovery.candidateFilters`** (owned here; each step reports what it removed):
   `excludeSelf`, `excludeSwiped`, `excludeBlocked`, `excludeInactive` (banned),
   `mutualPreferences`. They repeat the SQL's exclusions as an extension point and a second
   line of defence; steps that query have a 250 ms timeout (worker path only).
3. **`discovery.scorers`** (owned here): `recency`, `completeness`, `newUser`, `exposureCap`.
4. **`Ranker`** (`HandTunedRanker`): total = exposure gate × (base + Σ weight × score), the top 50,
   with the first 10 slots diversified. Scorer reasons are logged at debug level (`deck built`).
5. Write the deck (24 h TTL) and reset the served set.

Settings (`DISCOVERY_*`): weights base 0.25, recency 0.35, completeness 0.15, new user 0.25;
recency half-life 72 h; new-user boost for 7 days; exposure cap 300 per day; at most 3 boosted
new users in the first 10; no two cards in a row from the same college when another fits.

## Events

- **Emits:** `deck.served.v1`, one per page.
- **Consumes:** `user.blocked.v1` and `match.created.v1` remove the pair from both decks;
  `profile.updated.v1` rebuilds the user's own deck when their preferences, photos or status
  change (and drops it when the profile stops being active); `photo.approved.v1` rebuilds.

## Redis keys

- `discovery:deck:{uid}` (list, 24 h): up to 50 ranked ids.
- `discovery:served:{uid}` (set, 24 h): ids served, for swipe validation.
- `discovery:exposure:{yyyymmdd}:{uid}` (counter, 48 h): times shown today.

## Adapters

`pg/candidate-source.js`, `redis/deck-store.js`, `ranker/hand-tuned.js`, `jobs/builds.js`,
`events/consumers.js`, `http/routes.js`, `wiring.js`.
