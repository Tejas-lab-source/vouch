## Phase 6 — Profiles, media and photo pipeline: Completion Report

**Summary:** A signed-up user can fill in their profile and upload photos straight to object
storage with a presigned URL. The worker checks each photo, strips its metadata (including GPS),
resizes it to WebP and moderates it, and the profile becomes `active` once it has 2 approved
photos. Photos can be deleted, including while still processing, and deleting the account
erases the profile, upload records and files. Everything runs against real Postgres, Redis and
SeaweedFS (the local stand-in for R2), in tests and in the Docker image with `ROLE=all`.

**Completion criteria:**

- [x] **A user from Phase 5 creates a profile, uploads 2 photos and reaches `active` locally.**
      Evidence: the integration test "end to end: a Phase 5 user…", and a curl run against the
      Docker image (`ROLE=all`, Compose with SeaweedFS), shown below.
- [x] **The EXIF-stripping test passes.** A JPEG carrying GPS coordinates, a camera make and an
      orientation comes out as WebP with no EXIF, XMP, ICC or GPS block, rotated correctly. This
      is checked on the processor's output and on the files served from storage.
- [x] **Contracts are validated for all routes.** Every response in the integration suite is
      parsed with its contract schema (`getMyProfile`, `updateMyProfile`, `createUpload`,
      `confirmUpload`, `deleteMyPhoto`), and `ProfileCard` is checked on `getCards`. Routes
      also serialise through their contract schema.

**Owner decisions, as implemented:**

| Decision                                 | How it was met                                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. SeaweedFS, pinned                     | `chrislusf/seaweedfs:4.54` in Compose and Testcontainers. Day-1 check: a PUT with a different size or type than signed gets 403 `SignatureDoesNotMatch` (also an integration test), so no stop needed |
| 2. Photo keys                            | `photos/{photoKey}/{photoId}_{size}.webp`, 16 random bytes per photo; the seed uses the same format, and a test checks no seeded key contains a user id                                               |
| 3. Settings                              | 6 photos, 10 MB, 10-minute URLs, 1080/400 px, aspect kept, never upscaled, WebP q80, 50 MP: all env (`PHOTOS_MAX`, `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_SECONDS`, `IMAGE_*`)                           |
| 3. Change: concurrency 1, shrink-on-load | `IMAGE_WORKER_CONCURRENCY` defaults to 1 and now actually sets the `media` worker's concurrency; one pipeline per variant so JPEG and WebP shrink on load; peak memory measured below                 |
| 4. Photo id = upload id                  | Profiles consumes `photo.uploaded.v1` (pending at once); rejected photos stay visible with `urls: null` and don't count toward the limit                                                              |
| 5. Deletion                              | Profiles' `user.deleted.v1` consumer calls `media.deleteObjects(keys)`; media erases its own rows and objects on `user.deleted.v1`                                                                    |
| 6. `DELETE /v1/me/photos/{id}`           | Added (additive), idempotent, returns the updated `OwnProfile`                                                                                                                                        |
| Notes for later phases                   | Phase 12 photo reordering and client-side resizing to 2048 px recorded in `docs/PROGRESS.md`                                                                                                          |

**What was built:**

- `apps/api/src/modules/profiles/**`:
  - Domain: completeness, status transitions, age, age-range merge, photo positions.
  - Use cases: get, update, `putSection`, `deleteMyPhoto`, `createEmptyProfile`.
  - Cards: `getCards` with the Redis card cache and the `profiles.cardFields` chain.
  - Consumers, export and README.
- `apps/api/src/modules/media/**`:
  - Domain: keys, magic bytes, limit and confirm rules.
  - Use cases: `createUpload`, `confirmUpload`, processing, release, retention and export.
  - Adapters: S3 `StorageProvider`, sharp `ImageProcessor`, development `ContentCheck`, pg,
    HTTP, consumers and jobs. README.
- Migrations (expand-only):
  - `profiles/20261122002100_photo_tombstones.sql` adds the `deleted` photo status.
  - `media/20261122003100_upload_photo_key.sql` adds the `photo_key` column.
- Contracts:
  - `DELETE /v1/me/photos/{id}` and the `media.retentionTick` job.
  - Env: `PHOTOS_MAX`, `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_SECONDS`, `IMAGE_WEBP_QUALITY` and
    `IMAGE_MAX_PIXELS`. `IMAGE_WORKER_CONCURRENCY` now defaults to 1, and production requires
    `R2_ACCOUNT_ID`.
- Kernel:
  - Consumer `emit` and `afterCommit` hooks.
  - The registry collects section types.
  - `lockKey`.
  - Per-queue concurrency overrides.
- Infrastructure:
  - A `storage` service in `docker-compose.yml` and `infra/seaweedfs/s3.json`.
  - `startTestStorage()` in `packages/config/test/containers.js`.
  - `pnpm storage:init`.
- Seed: photo keys in the new format.
- Docs: ADR 0012, `data-model.md` (keys, tombstones, retention), CHANGELOG, PROGRESS.

**Tests and validation** (clean clone; Node v24.22.3, pnpm 10.34.9):

```
pnpm lint / format:check / typecheck / check:boundaries / contracts:check   → all exit 0
pnpm contracts:diff --base origin/main  → No breaking contract changes against origin/main.
pnpm test                               → 44 s
  @vouch/contracts  Tests 371 passed
  @vouch/config     Tests 4 passed
  @vouch/api        Tests 270 passed (33 files) · src/platform lines 98.32%
```

The API suite also passed two more consecutive runs (270/270 each), and the new module suites
passed two further runs (117/117). CI run 31 (`a6d04b8`) passed both jobs.

New tests (54 in the API):

- **Media domain (7):** key layout (no user id), magic bytes (JPEG, PNG, WebP; text, GIF,
  truncated), the limit rule, the confirm rule.
- **Image processor, real sharp (5):** GPS EXIF really present in the input; output WebP at
  1080 and 400 px with no EXIF, XMP, ICC or GPS and the orientation applied; never upscaled;
  over the pixel limit refused; non-image and truncated input refused.
- **Media use cases with fakes (14):**
  - presign signs the exact size, type and key; `UPLOAD_MAX_BYTES`; 6-photo limit with rejected
    and expired presigns freeing places
  - confirm checks the stored object and emits once
  - approve, `not_an_image`, a PNG declared as JPEG, moderation reject, `review`
  - deleted while processing, retry reusing the photo key, `processing_failed` on the last
    attempt
  - the API's key prefixes and owner checks; retention
- **Profiles domain (7):** completeness, transitions (including `hidden`), the age-range merge,
  positions, age.
- **Profiles use cases with fakes (6):**
  - the age-range error, and a registered section validated by schema and version
  - activation and back to pending on delete
  - a late approval of a deleted photo, someone else's photo id
  - account deletion calling `deleteObjects`
- **Integration (10)**, on Postgres, Redis and SeaweedFS, with `ROLE=all` and identity, profiles
  and media:
  - `user.created.v1` redelivered (inbox duplicate, and a replay with a new id) leaves one profile
  - the end-to-end flow to `active`, with variants fetched anonymously from the CDN base (WebP,
    right widths, no EXIF or GPS) and raw and staging objects deleted
  - the card cache: Redis TTL ≈ 600 s, an edit deletes the key, pending profiles have no card
  - a renamed non-image is rejected with nothing published
  - storage refuses a larger body or another type (403), confirm returns `UPLOAD_NOT_UPLOADED`,
    and raw uploads are not public
  - the 6-photo limit; delete frees a place, removes the files and is idempotent
  - deletion during processing leaves a tombstone and no files
  - export and account deletion
  - retention SQL; `UNKNOWN_SECTION_TYPE`
- **Kernel (4):** consumer `emit` and `afterCommit` (not run on failure, best-effort), the
  concurrency override, section registration (duplicate or mismatched type refused), `lockKey`.
- **Seed (1):** key format and no user id.

Mutation checks (each reverted afterwards):

| Mutation                                      | Result       |
| --------------------------------------------- | ------------ |
| Keep EXIF (`keepExif()`)                      | 2 tests fail |
| No tombstone check on late photo results      | 1 test fails |
| No magic-byte check                           | 1 test fails |
| No card-cache invalidation on edit            | 1 test fails |
| No photo limit                                | 2 tests fail |
| Size and type not signed in the presigned URL | 1 test fails |

**End-to-end run** (Docker image `vouch-api:phase6`, `ROLE=all`, Compose with Postgres, Redis
and SeaweedFS; two 12 MP photo-like JPEGs of about 1.9 MB with GPS EXIF):

```
1)  sign up (Phase 5 flow)                                  405 ms
2)  GET /v1/me/profile   → pending, missing [name, gender, interestedIn, photos], ages 18–30
3)  PATCH /v1/me/profile → pending, missing [photos]
4a) photo a (1890 KB): presign 116 ms, PUT 200 242 ms, confirm 48 ms, approved after 3701 ms
4b) photo b (1806 KB): presign 85 ms,  PUT 200 32 ms,  confirm 35 ms, approved after 2660 ms
5)  GET /v1/me/profile   → active, missing [], photos [approved, approved]
6)  variant URL http://localhost:8333/vouch/photos/<photoKey>/<photoId>_1080.webp
7)  raw upload URL fetched anonymously → 403
total 7.5 s · no error logs · test email in logs: 0 · docker stop --time 30 → exit 0
```

- Of the time from confirm to approved, about 0.5 s is image processing (measured 450–550 ms
  for a 12 MP JPEG, locally and in the image). The rest is two event hops through the outbox
  relay, which polls every 2 s when idle (Phase 4). With the relay busy, as in the
  integration suite, upload to approved takes 0.58 s.
- SeaweedFS's very first write takes about 5 s (it allocates a volume). The test suite warms it
  up first.

**Variant sizes** (from synthetic images; no real photographs were available to test with):

| Source                                 | w1080   | w400   |
| -------------------------------------- | ------- | ------ |
| 12 MP photo-like JPEG (end-to-end run) | 85.2 KB | 1.2 KB |
| 12 MP photo-like JPEG (local run)      | 30.9 KB | 0.6 KB |
| Flat test images (integration suite)   | 2.8 KB  | 0.5 KB |

Synthetic textures shrink unrealistically at 400 px. ARCHITECTURE.md 3.1 assumes 165 KB per
photo for both variants; real sizes should be measured with real uploads in Phase 12.

**Peak memory, one 50 MP image** (`IMAGE_MAX_PIXELS` 50,000,000; 8160×6120, max RSS of a fresh
Node process):

| Input                                       | Peak RSS | Above idle process |
| ------------------------------------------- | -------- | ------------------ |
| Idle (Node + sharp loaded)                  | 69 MB    | —                  |
| JPEG 1.2 MB (under the 10 MB upload limit)  | 84 MB    | +15 MB             |
| JPEG 33 MB (noise; over the upload limit)   | 114 MB   | +45 MB             |
| WebP 28 MB                                  | 110 MB   | +41 MB             |
| PNG 4.4 MB (PNG cannot shrink on load)      | 152 MB   | +83 MB             |
| Same 1.2 MB JPEG **without** shrink-on-load | 236 MB   | +167 MB            |

- **Inside the Docker image:** the 50 MP JPEG adds 13 MB (75 to 88 MB) and the PNG adds 50 MB.
- **Whole `ROLE=all` server process:** after processing both 50 MP files through the real
  upload flow, plus the 12 MP photos and the HTTP traffic, its peak RSS (VmHWM) was 236 MB, with
  110 MiB at idle. That leaves headroom on a 512 MB instance at concurrency 1.

**Configuration values chosen:**

| Setting                    | Value                                         |
| -------------------------- | --------------------------------------------- |
| `PHOTOS_MAX`               | 6 (2 needed to be active)                     |
| `UPLOAD_MAX_BYTES`         | 10,485,760 (10 MB)                            |
| `UPLOAD_URL_TTL_SECONDS`   | 600                                           |
| `IMAGE_WORKER_CONCURRENCY` | 1                                             |
| `IMAGE_MAX_PIXELS`         | 50,000,000                                    |
| `IMAGE_WEBP_QUALITY`       | 80                                            |
| Variants                   | 1080 and 400 px wide, never upscaled          |
| Card cache                 | 10 minutes                                    |
| Upload-row retention       | 7 days (rejected, never confirmed)            |
| `media` queue              | 3 attempts, 5 s base backoff (Phase 4 policy) |
| Variant cache header       | `public, max-age=31536000, immutable`         |

**Decisions made:** [ADR 0012 — Media storage, photo keys and the image pipeline](../adr/0012-media-storage-and-photo-keys.md)

**Deviations from the roadmap:**

- **Two expand-only migrations:**
  - `profiles.photos` gains a `deleted` status, a tombstone so that a late approval cannot
    restore a deleted photo.
  - `media.uploads` gains `photo_key`, so retries reuse the same random key.
- **Kernel additions:**
  - Event consumers can `emit` and register `afterCommit` hooks, so profiles emits
    `profile.updated.v1` and invalidates cards after commit.
  - The registry collects section types (extension point 9).
  - `lockKey`.
  - A per-queue concurrency override: `IMAGE_WORKER_CONCURRENCY` was declared but unused.
- **Variants are staged before moderation.** They are written to private
  `uploads/processed/…` first, because `safety.contentChecks` takes an object key. They are
  published under `photos/` only after approval.
- **Upload-row retention keeps approved rows** while their photo exists. `data-model.md`
  said 7 days for all upload rows, but approved rows hold the photo key and count toward the
  limit. Only rejected and never-confirmed rows are purged after 7 days, by a new job contract,
  `media.retentionTick`.
- **`getMyProfile` creates the empty profile** if `user.created.v1` hasn't been consumed yet,
  using `identity.api`. That avoids a 404 right after sign-up.
- **Creating the empty profile emits no `profile.updated.v1`,** because the profile is not
  visible to anyone yet.
- **A `review` verdict leaves the upload `processing`.** Human review belongs to Phase 7.

**Known issues and risks:**

- **Approval latency:** from confirm to approved takes up to about 4 s while the system is
  idle, because of the outbox relay's 2 s idle poll across two hops. Processing itself takes
  about 0.5 s.
- **Card cache race:** a card built from a read that raced with an edit can be cached stale for
  up to 10 minutes. Invalidation runs after commit, so this needs a read and a write to overlap
  within milliseconds.
- **R2 not exercised:** the R2 adapter was tested only against SeaweedFS. R2 behaviour (its
  signature enforcement, path-style URLs, lifecycle rule) is checked in Phase 15.
- **CORS for web uploads:** browser uploads to R2 will need a bucket CORS rule for the web
  origin (Phase 11 or 12).
- **Synthetic images only:** variant sizes and memory figures come from synthetic images.
- **Image size:** the Docker image grew to 536 MB (from 483 MB).
- **Seed values changed:** the seed now draws the photo keys too, so its generated values differ
  from Phase 5's. It is still deterministic.

**Suggested follow-ups (not done, need approval):**

1. Phase 7: replace the development `ContentCheck` with the `safety.contentChecks` pipeline, and
   handle `review` uploads.
2. Phase 15:
   - Apply the R2 lifecycle rule (`uploads/`, 1 day).
   - Make the CDN serve `photos/` only.
   - Test the R2 adapter against real R2.
   - Consider a shorter idle relay interval, or Postgres `LISTEN/NOTIFY`, to cut event latency.
3. Phase 11 or 12: an R2 CORS rule for web uploads, and real-photo variant sizes.

**How you can check it yourself:**

```bash
cp .env.example .env && pnpm dev:keys --write && docker compose up -d --wait && pnpm db:migrate && pnpm db:seed && pnpm storage:init
```

```bash
cd apps/api && node --env-file=../../.env src/main.js
```

```bash
pnpm --filter @vouch/api exec vitest run test/modules/profiles/photos.integration.test.js
```

Then follow the Phase 5 sign-up, `PATCH /v1/me/profile`, and for each photo:

1. `POST /v1/media/uploads` with `{ contentType, sizeBytes }`.
2. `PUT` the file to the returned `url`, with its `content-type`.
3. `POST /v1/media/uploads/{uploadId}/confirm`.
4. Poll `GET /v1/me/profile`.

**Pull request:** [Tejas-lab-source/vouch#6](https://github.com/Tejas-lab-source/vouch/pull/6) · Branch:
`claude/lucid-rubin-foq2uj` (ADR 0002)
