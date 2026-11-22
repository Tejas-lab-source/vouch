# safety

Part 1 (Phase 7): blocking, the block policy every read path uses, ban lookups, and photo
moderation through the `safety.contentChecks` pipeline. Part 2 (Phase 10, ADR 0020): reports
with evidence snapshots and auto-hide, moderation actions, bans, the ID-card verification
fallback, the photo review queue and repeat offences. The admin module calls part 2 through
`api.moderation` and writes the audit log.

## Public API (`api.js`)

| Function                                | Returns                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| `blockPolicy.isBlocked(a, b, { tx? })`  | Whether either user blocked the other (Redis, then Postgres) |
| `blockPolicy.blockedAmong(viewer, ids)` | The ids the viewer must not see (one lookup for many)        |
| `isBanned(userId)`, `bannedAmong(ids)`  | Active bans (`lifted_at` null, not expired)                  |

| `unblock({ blockerId, blockedId })` | Staff remove a block (admin only; `POST /v1/admin/users/{userId}/unblock`) |
| `moderation.*` | Reports, actions, bans, ID reviews, photo reviews and user facts (admin) |

`listBlocked` has no route yet (user route in Phase 13).

## HTTP routes

| Route                                   | Auth                  | Use case                                                                  |
| --------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `POST /v1/blocks`                       | user                  | `block`: idempotent; `NOT_FOUND` for unknown users; no self-blocking      |
| `POST /v1/reports`                      | user                  | `report`: evidence snapshot; 20 a day; auto-hide at 3 reporters in 7 days |
| `POST /v1/verification/id-card/uploads` | user (pending review) | Presigned PUTs for the ID photo and a selfie (private `verification/`)    |
| `POST /v1/verification/id-card`         | user (pending review) | Submits them for review (idempotent on the submission id)                 |

### Reports

- Chat reports run the fail-closed `safety.reportEvidence` pipeline. Chat's step returns the
  last 20 messages only when the reporter and the target are that conversation's two members
  (`NOT_A_MEMBER` otherwise). Profile reports keep the profile card.
- Staff resolve a report with `dismiss`, `warn`, `hide`, `unhide` or `ban` (admin only). The
  report is then closed (`CONFLICT` if it already was).
- At `REPORT_AUTOHIDE_REPORTERS` distinct reporters within `REPORT_AUTOHIDE_DAYS`, the profile
  is hidden through profiles' API.

### Bans

- A ban emits `user.banned.v1`:
  - identity revokes sessions and sets the account to `banned`
  - matching ends matches, so chat closes conversations (the other person sees `unmatched`)
  - discovery hides the user
- Lifting a ban, or the nightly expiry, emits `user.unbanned.v1`.
- One active ban per user (`CONFLICT`).

### ID-card verification

Only for `pending_review` accounts (ID-card sign-up):

1. The student uploads an ID photo and a selfie to private storage and submits them.
2. Staff approve or reject through 5-minute signed URLs.
3. A decision emits `verification.decided.v1`.
4. The images are deleted 30 days after the decision.

### Repeat offences

Moderation rejections (`photo.rejected.v1`, reason `moderation`) are counted per user. At
`PHOTO_REJECTIONS_FOR_REVIEW` in 30 days, one system report opens.

## Events

- **Emits:**
  - `user.blocked.v1`, once per new block, in the same transaction as the insert
  - `report.created.v1`
  - `user.banned.v1` and `user.unbanned.v1`
  - `verification.decided.v1`
- **Consumes:**
  - `photo.rejected.v1` (repeat offences)
  - `user.deleted.v1`: erases blocks, ID reviews and their images, and offence counts.
    Reports stay as moderation records; an active ban stays.

## Jobs

- **`safety.retentionTick`** (nightly 04:07 UTC):
  - lifts expired bans
  - deletes ID images 30 days after the decision
  - deletes report evidence 1 year after close
  - deletes bans 30 days after they ended, and offence counts after 30 days

## Pipelines

- **Owns `safety.reportEvidence`** (fail closed, 2 s per step; Phase 10). Chat contributes the
  messages of a chat report.
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

`blocks`, `reports` (with the resolution columns), `bans`, `verification_reviews` (with
`selfie_image_key`) and `photo_rejections`. View: `safety.block_pairs_v` (both directions).

## Redis keys

- `safety:blocked:{uid}` (set, no TTL): everyone in a block with the user, either direction,
  plus a "loaded" marker. A set without the marker is not trusted: it is reloaded from
  Postgres. Blocking adds both ids before the transaction commits, and fails with
  `TEMPORARILY_UNAVAILABLE` if Redis is down, so the cache never says "not blocked" wrongly.

## Adapters

`pg/stores.js`, `redis/block-cache.js`, `moderation/rekognition.js`, `moderation/dev.js`,
`http/routes.js`, `wiring.js`.
