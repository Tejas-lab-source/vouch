# safety

Part 1 (Phase 7): blocking, the block policy every read path uses, ban lookups, and photo
moderation through the `safety.contentChecks` pipeline. Reports, ban management and the
moderation queue arrive in Phase 10.

## Public API (`api.js`)

| Function                                | Returns                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| `blockPolicy.isBlocked(a, b, { tx? })`  | Whether either user blocked the other (Redis, then Postgres) |
| `blockPolicy.blockedAmong(viewer, ids)` | The ids the viewer must not see (one lookup for many)        |
| `isBanned(userId)`, `bannedAmong(ids)`  | Active bans (`lifted_at` null, not expired)                  |

Use cases without routes yet: `unblock` (admin only, route in Phase 10) and `listBlocked`
(user route in Phase 13).

## HTTP routes

| Route             | Auth | Use case                                                             |
| ----------------- | ---- | -------------------------------------------------------------------- |
| `POST /v1/blocks` | user | `block`: idempotent; `NOT_FOUND` for unknown users; no self-blocking |

## Events

- **Emits:** `user.blocked.v1`, once per new block, in the same transaction as the insert.
- **Consumes:** none yet.

## Pipelines

- **Owns `safety.contentChecks`** (fail closed, 5 s per step). Step `safety.imageModeration`
  asks the `ModerationProvider` about the processed photo's bytes and returns a verdict. Media
  runs the chain; the strictest verdict wins, and no verdict means no approval.

## Moderation (ADR 0013)

- **Provider:** Amazon Rekognition (`DetectModerationLabels`, plus `DetectFaces` with
  `AGE_RANGE`) in `MODERATION_AWS_REGION` (default `ap-south-1`). The WebP variant is re-encoded
  to JPEG in memory first, because Rekognition accepts only JPEG and PNG.
- **Rules** (`domain/moderation.js`):
  - Explicit nudity or sexual content, graphic violence or gore, and hate symbols at
    `MODERATION_REJECT_CONFIDENCE` (80) or more are rejected.
  - The same labels at `MODERATION_REVIEW_CONFIDENCE` (50) or more go to review.
  - Suggestive content (swimwear, underwear) is allowed.
  - A face whose estimated `AgeRange.High` is below `MODERATION_MINOR_AGE` (18) goes to review,
    never to rejection (`MODERATION_FACE_AGE_CHECK`, default on).
- **Failures:** any provider error throws; media retries 3 times, then rejects the photo as
  `processing_failed`.
- **Development:** `MODERATION_PROVIDER=dev` approves everything (refused in production).

## Tables owned (schema `safety`)

`blocks`, `reports`, `bans`, `verification_reviews`. View: `safety.block_pairs_v` (both
directions). Phase 7 writes only `blocks`.

## Redis keys

- `safety:blocked:{uid}` (set, no TTL): everyone in a block with the user, either direction,
  plus a "loaded" marker. A set without the marker is not trusted: it is reloaded from
  Postgres. Blocking adds both ids before the transaction commits, and fails with
  `TEMPORARILY_UNAVAILABLE` if Redis is down, so the cache never says "not blocked" wrongly.

## Adapters

`pg/stores.js`, `redis/block-cache.js`, `moderation/rekognition.js`, `moderation/dev.js`,
`http/routes.js`, `wiring.js`.
