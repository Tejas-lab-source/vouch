# 0012 — Media storage, photo keys and the image pipeline

- Status: Accepted (by owner on 2026-11-22, Phase 6 start plan)
- Phase: 6

## Context

Photos go from the client straight to object storage by presigned URL (ARCHITECTURE.md 8.7),
are cleaned and resized by a worker, moderated, and then served by a CDN. Production storage is
Cloudflare R2. Development and tests need an S3-compatible server that really enforces the
signed size and type, which is the security boundary for uploads. MinIO's images are no longer
published on Docker Hub. The beta server has 512 MB of memory. Photo URLs are public, so they
must not reveal internal ids (owner decision, Phase 3).

## Decision

**Storage**

- One `StorageProvider` port with an S3 adapter (`@aws-sdk/client-s3` and the presigner): R2
  in production (`R2_ACCOUNT_ID`), SeaweedFS locally (`R2_ENDPOINT`, refused in production).
- Local server: `chrislusf/seaweedfs:4.54` (Apache-2.0), in Compose and Testcontainers. Its
  config (`infra/seaweedfs/s3.json`) has development-only credentials and lets anonymous
  clients read `photos/*` only, standing in for the CDN.
- Verified on day 1 (and in the integration suite): a PUT with a different size or content type
  than signed gets 403 `SignatureDoesNotMatch`; raw uploads are not readable anonymously; the
  bucket cannot be listed anonymously.
- The SDK adds checksums only when an operation requires them: its default checksum in a
  presigned URL is computed over an empty body and breaks every upload.

**Keys**

- Raw: `uploads/raw/{uploadId}`. Variants awaiting moderation:
  `uploads/processed/{uploadId}_{size}.webp`. Both private; an R2 lifecycle rule deletes
  `uploads/` after 1 day (applied in Phase 15), and the worker deletes them as soon as it is done.
- Approved: `photos/{photoKey}/{photoId}_{size}.webp` (owner decision, Phase 6). `photoKey` is 16
  random bytes, base64url, chosen once per photo and stored in `media.uploads.photo_key`, so a
  retried job overwrites the same objects. No internal user id appears in any key, and photos
  cannot be linked to each other or to the account by URL. The seed uses the same layout.
- The photo id is the upload id (owner decision), so profiles can show a pending photo at once.
- The database stores keys only; URLs are `CDN_BASE_URL + key`.

**Image pipeline (sharp)**

- Magic bytes must match the declared type. Images over `IMAGE_MAX_PIXELS` (50 MP) are refused
  from the header, before decoding.
- Each variant (1080 and 400 px wide, aspect ratio kept, never upscaled, WebP quality 80) is its
  own pipeline from the encoded input, so JPEG and WebP use shrink-on-load; `sequentialRead`,
  no libvips cache, one libvips thread, and `IMAGE_WORKER_CONCURRENCY` images at once (default
  1). EXIF orientation is applied, and all metadata (EXIF including GPS, XMP, ICC) is dropped.
- Measured peak RSS for one 50 MP image (Phase 6 report): about 15 MB above an idle process for
  a typical JPEG, 83 MB for a PNG (no shrink-on-load); 167 MB without shrink-on-load.

**Deletion**

- A photo the owner deletes keeps a `deleted` row in `profiles.photos` (a tombstone, no keys) so
  a late `photo.approved.v1` cannot bring it back (expand-only migration). Profiles then calls
  `media.releaseUpload`, which deletes the upload row and every object, including the output of
  a job still running: the worker finds the row gone and deletes what it wrote.
- Account deletion: profiles deletes photo files through `media.deleteObjects`; media also
  erases its own rows and objects on `user.deleted.v1` (owner decision).

**Limits and settings** (env, owner decisions): 6 photos, 10 MB per upload, 10-minute presigned
URLs. The limit counts pending (unexpired), uploaded, processing and approved uploads; rejected
ones do not. Presigns are serialised per user with an advisory lock.

## Alternatives considered

- **MinIO:** the image is no longer on Docker Hub; `quay.io` was not reachable from the build
  environment.
- **A filesystem adapter for tests:** cannot test that storage enforces the signature.
- **`photos/{publicId}/…`:** media does not own `publicId`, it would link every photo of a user,
  and URLs would change if it ever did.
- **Resizing in one pipeline with `clone()`:** decodes the full image once; shrink-on-load per
  variant uses much less memory.

## Consequences

- Photo URLs reveal nothing about the account.
- Local development runs one more container; `pnpm storage:init` creates the bucket once.
- Phase 15 must apply the `uploads/` lifecycle rule and make the CDN serve `photos/` only.
- The Docker image grew from 483 to 536 MB (sharp, libvips and the AWS SDK).
