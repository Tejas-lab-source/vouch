# media

Photo uploads straight to object storage by presigned URL, and the image worker that checks,
cleans, resizes and moderates them. Photo bytes never pass through the API process. Storage is
Cloudflare R2 in production and SeaweedFS locally (ADR 0012).

## Public API (`api.js`)

| Function                            | What it does                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `deleteObjects(keys)`               | Deletes objects under `photos/` or `uploads/` (other keys are refused). Idempotent             |
| `releaseUpload(uploadId, userId)`   | Forgets one upload (a deleted photo) and deletes all its objects, even mid-processing          |
| `resolveReview(uploadId, decision)` | The moderation queue's decision (`approve` or `reject`) on a photo held for review; idempotent |
| `photoUrl(key)`                     | `CDN_BASE_URL` + key                                                                           |

## HTTP routes (contracts in `packages/contracts/src/http/media.js`)

| Route                                 | Auth | Use case                                                             |
| ------------------------------------- | ---- | -------------------------------------------------------------------- |
| `POST /v1/media/uploads`              | user | `createUpload`: presigned PUT with the exact size and type signed    |
| `POST /v1/media/uploads/{id}/confirm` | user | `confirmUpload`: checks the object (HEAD), emits `photo.uploaded.v1` |

The client PUTs the file to the returned `url` with the returned `content-type` (its HTTP
client sets `content-length`). Storage refuses any other size or type with 403, and confirm
refuses with `UPLOAD_NOT_UPLOADED` unless the stored object matches.

## Events

- **Emits:** `photo.uploaded.v1` (confirm), `photo.approved.v1` and `photo.rejected.v1`
  (worker). The photo id is the upload id.
- **Consumes:** `photo.uploaded.v1` queues `media.processImage` (job id `process-{uploadId}`);
  `user.deleted.v1` deletes the user's upload rows and every object they own.

## Jobs (queue `media`)

- **`media.processImage`**, concurrency `IMAGE_WORKER_CONCURRENCY` (default 1, for a 512 MB
  instance). Steps, each safe to retry:
  1. Mark `processing` and choose the photo key once (`media.uploads.photo_key`).
  2. Read the raw object; the magic bytes must match the declared type (`not_an_image`).
  3. sharp: refuse over `IMAGE_MAX_PIXELS` (`too_large`); auto-rotate; strip all metadata
     (EXIF including GPS, XMP, ICC); WebP at 1080 and 400 px wide, never upscaled, quality
     `IMAGE_WEBP_QUALITY`. Each width is its own pipeline, so JPEG and WebP use shrink-on-load.
  4. Write both variants to the private `uploads/processed/` prefix and run the `ContentCheck`
     port on the 1080 px one, with its bytes: the `safety.contentChecks` pipeline (Phase 7).
     `review` keeps the variants under the private `review/` prefix and marks the upload
     `in_review` (its owner sees the photo as pending) until `resolveReview` decides.
  5. Approved: write `photos/{photoKey}/{photoId}_{1080|400}.webp` (immutable cache headers),
     then mark approved and emit, then delete the private objects. Rejected: mark rejected and
     emit, then delete the private objects; nothing is ever written under `photos/`.
  6. If the upload was released meanwhile, everything written is deleted.

  Infrastructure errors retry with backoff (3 attempts); the last failure rejects the upload as
  `processing_failed`.

- **`media.retentionTick`** (nightly, 03:53 UTC): deletes rejected and never-confirmed upload
  rows older than 7 days (and any objects they still own). Approved rows stay while their photo
  exists: they hold its photo key and count toward the limit.

## Tables owned (schema `media`)

`uploads`: one row per presigned upload, with its status (`pending → uploaded → processing →
in_review → approved | rejected`; `in_review` since Phase 7), the signed size (`max_bytes`) and the random `photo_key`.

## Object keys

| Prefix                                     | Contents                     | Access                                 |
| ------------------------------------------ | ---------------------------- | -------------------------------------- |
| `uploads/raw/{uploadId}`                   | The file as uploaded         | Private; R2 lifecycle deletes at 1 day |
| `uploads/processed/{uploadId}_{size}.webp` | Variants awaiting moderation | Private; same lifecycle                |
| `review/{uploadId}_{size}.webp`            | Variants held for review     | Private; kept until the decision       |
| `photos/{photoKey}/{photoId}_{size}.webp`  | Approved variants            | Public through the CDN                 |

`photoKey` is 16 random bytes (base64url) per photo, so a URL never contains an internal user
id and cannot be linked to the account or to the user's other photos.

## Settings (env, defaults)

`PHOTOS_MAX` 6, `UPLOAD_MAX_BYTES` 10 MB, `UPLOAD_URL_TTL_SECONDS` 600,
`IMAGE_WORKER_CONCURRENCY` 1, `IMAGE_WEBP_QUALITY` 80, `IMAGE_MAX_PIXELS` 50,000,000.

## Rules

- **Limit:** pending (unexpired), uploaded, processing and approved uploads count toward
  `PHOTOS_MAX`; rejected ones do not. Presigns are serialised per user with an advisory lock.

## Adapters

- `storage/s3.js`: `StorageProvider` on `@aws-sdk/client-s3` (R2 or SeaweedFS). Checksums only
  when required (a default checksum in a presigned URL breaks uploads), timeouts on every call.
- `image/sharp.js`: `ImageProcessor`. `content-check/pipeline.js`: `ContentCheck` through
  `safety.contentChecks` (Phase 7): the strictest verdict wins; no verdict throws.
- `pg/stores.js`, `http/routes.js`, `events/consumers.js`, `jobs/process-image.js`.
