# 0013 — Photo moderation with Amazon Rekognition

- Status: Accepted (by owner on 2026-11-22, Phase 7 start plan)
- Phase: 7

## Context

Every photo must be moderated before anyone else sees it (ARCHITECTURE.md 8.7). Phase 6 left a
development `ContentCheck` that approved everything. A dating app for 18+ students must keep out
explicit content, graphic violence and hate symbols, and should catch possible minors. The
users and their photos are in India (DPDP), the beta budget is small, and the image worker runs
on a 512 MB instance.

## Decision

- **Provider:** Amazon Rekognition `DetectModerationLabels`, plus `DetectFaces` with
  `AGE_RANGE`, in `ap-south-1` (Mumbai), behind a `ModerationProvider` port
  (`@aws-sdk/client-rekognition`). About $0.001 per image at beta volume (AWS's 2021 pricing),
  so about $70 for the beta's onboarding photos. Moderation support in Mumbai and the current
  price are confirmed in Phase 15, when real keys exist.
- **The chain:** safety owns `safety.contentChecks` (fail closed, 5 s per step); its step
  `safety.imageModeration` calls the provider. Media runs the chain with the processed photo's
  bytes, an additive field on the pipeline input: providers cannot read private storage. The
  strictest verdict of all steps wins; a chain with no verdict throws.
- **Format:** Rekognition accepts JPEG and PNG only, so the 1080 px WebP is re-encoded to JPEG
  in memory before the call (well under its 5 MB byte limit).
- **Rules** (owner decisions, all thresholds in env):
  - Reject at 80% or more: explicit nudity or sexual content, graphic violence or gore, and hate
    symbols. A label matches by its own name or its parent's, which covers both Rekognition
    taxonomy versions.
  - Review at 50–80% for the same labels.
  - Allow suggestive content (swimwear, underwear).
  - Review, never reject, when a face's estimated `AgeRange.High` is below 18
    (`MODERATION_MINOR_AGE`).
- **Review:** the upload becomes `in_review` and its variants wait under the private `review/`
  prefix (outside `uploads/`, which expires after a day). The owner sees the photo as pending.
  There is no automatic decision: Phase 10's moderation queue calls `media.api.resolveReview`,
  and alerts when a photo has waited more than 48 hours.
- **Fail closed:** a provider error throws; the image job retries 3 times with backoff, then
  rejects the photo as `processing_failed` so the user can upload again. A photo is never
  approved without a verdict.
- **Development:** `MODERATION_PROVIDER=dev` approves everything and is refused in production.
  Tests run the real adapter against a local fake endpoint (`MODERATION_ENDPOINT`, test-only).

## Alternatives considered

- **Google Cloud Vision SafeSearch:** about $1.50 per 1,000 after 1,000 free a month and takes
  WebP, but its labels are coarser (likelihoods, no taxonomy) and in-India processing was not
  confirmed.
- **Sightengine:** simple pricing ($29 a month for 10,000 checks), but dearer at beta volume and
  processed outside India.
- **Self-hosted models:** too heavy for a 512 MB worker.

## Consequences

- An AWS account and an IAM key limited to the two Rekognition operations are needed in
  production (`MODERATION_AWS_ACCESS_KEY_ID`, `MODERATION_API_KEY`).
- Photos are sent to AWS for moderation; the privacy notice must say so (Phase 14 legal review).
- Possible minors and borderline photos wait for a human until Phase 10's queue exists.
