# Progress

Status values: `Not started`, `Plan sent`, `In progress`, `Report sent`, `Approved`.
See `docs/ROADMAP.md` Part A for the approval protocol.

| #   | Phase                                                                   | Status      | Start approved | Completed approved | Report             |
| --- | ----------------------------------------------------------------------- | ----------- | -------------- | ------------------ | ------------------ |
| 1   | Repository foundation and tooling                                       | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-01.md |
| 2   | Database architecture and migrations                                    | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-02.md |
| 3   | API, event and socket contracts                                         | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-03.md |
| 4   | Backend platform kernel                                                 | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-04.md |
| 5   | Identity and authentication                                             | Approved    | 2026-11-21     | 2026-11-22         | phases/PHASE-05.md |
| 6   | Profiles, media and photo pipeline                                      | Approved    | 2026-11-22     | 2026-11-22         | phases/PHASE-06.md |
| 7   | Safety core and discovery engine                                        | Approved    | 2026-11-22     | 2026-11-22         | phases/PHASE-07.md |
| 8   | Matching                                                                | Plan sent   | —              | —                  | —                  |
| 9   | Realtime chat                                                           | Not started | —              | —                  | —                  |
| 10  | Notifications, moderation and admin backend                             | Not started | —              | —                  | —                  |
| 11  | Frontend foundation                                                     | Not started | —              | —                  | —                  |
| 12  | Frontend features I (onboarding, profile, discovery, matching)          | Not started | —              | —                  | —                  |
| 13  | Frontend features II (chat, notifications, safety, settings, admin app) | Not started | —              | —                  | —                  |
| 14  | End-to-end testing, security, privacy and performance                   | Not started | —              | —                  | —                  |
| 15  | Deployment, observability and closed beta launch                        | Not started | —              | —                  | —                  |

## Notes for later phases

Owner instructions recorded here so the phase that owns them picks them up.

- **Process rule (owner, 2026-11-22, all phases):** never pipe a check command so that its
  failure is hidden; run checks unpiped or with `set -o pipefail`. A failing check must stop
  the commit.

- **Phase 6 — photo object keys (owner, 2026-11-21):** photo object keys must not contain the
  internal user id. Use `photos/{publicId or random key}/{photoId}_{size}.webp`, so internal
  ids never appear in public CDN URLs. This replaces the `photos/{userId}/…` layout in roadmap
  Phase 6. The Phase 2 seed (`apps/api/scripts/seed.js`) still builds placeholder keys from the
  internal id and must be updated with it. _Done in Phase 6: a random key per photo, seed
  updated (ADR 0012)._
- **Phase 7 — photo moderation (owner, 2026-11-22, from the Phase 6 report):** connect the real
  `safety.contentChecks` pipeline in place of media's development `ContentCheck`, and the
  needs-review path for photos (a `review` verdict currently leaves the upload `processing`).
  _Done in Phase 7 (ADR 0013)._
- **Phase 10 — photo review alert (owner, 2026-11-22, Phase 7 plan):** alert if any photo has
  been `in_review` for more than 48 hours (Phase 7 holds photos for review with no automatic
  decision; the moderation queue resolves them through `media.api.resolveReview`).
- **Phase 10 — identity follow-ups (owner, 2026-11-22, from the Phase 5 report):**
  - The ID-card fallback route for students without a college email.
  - Admin login with MFA (`vouch:admin` audience).
  - `user.unbanned.v1` and the unban flow.
  - Ban evasion across deletion: a banned user who deletes their account must not be able to
    sign up again with the same email after the 30-day erasure.
- **Phase 12 — photos on the client (owner, 2026-11-22, from the Phase 6 plan):**
  - Photo reordering (no endpoint exists yet; add one additively when the screen needs it).
  - Resize photos on the client to at most 2048 px on the long edge before upload.
- **Phase 11/12 — web uploads and real photos (owner, 2026-11-22, from the Phase 6 report):**
  - An R2 CORS rule so browsers can PUT presigned uploads from the web origin.
  - Measure variant sizes on real photos (Phase 6 only had synthetic images).
- **Phase 13 — blocked users screen (owner, 2026-11-22, Phase 7 plan):** user routes for
  `listBlocked` (and admin `unblock` in Phase 10) are not built yet; add them additively when
  the settings screen needs them.
- **Phase 14 — session revocation (owner, 2026-11-22):** check the session on sensitive routes,
  so a revoked session's access token (valid up to 15 minutes) cannot use them.
- **Phase 15 — deploy and runtime (owner, 2026-11-21, from the Phase 4 report):**
  - Start Node with `--import @opentelemetry/auto-instrumentations-node/register`, so ESM
    libraries are auto-instrumented.
  - Set the host's stop timeout to 30 s (the app drains for `SHUTDOWN_DRAIN_MS`, 25 s by
    default).
  - Trim the Docker image (483 MB after Phase 4, mostly OpenTelemetry and Sentry; 536 MB after
    Phase 6 with sharp and the AWS SDK).
  - Test Resend (email) and Turnstile (captcha) against the real services with real keys
    (owner, 2026-11-22; Phase 5 only tested them with fakes).
  - Media (owner, 2026-11-22, from the Phase 6 report): the R2 lifecycle rule deleting
    `uploads/` after 1 day; a CDN that serves `photos/` only; testing the storage adapter
    against real R2; faster event delivery (a shorter idle relay poll or Postgres
    `LISTEN/NOTIFY`; photo approval waits up to about 4 s on an idle system).
  - Moderation (owner, 2026-11-22, Phase 7 plan): with real AWS keys, confirm that Rekognition
    content moderation (`DetectModerationLabels`, `DetectFaces`) runs in `ap-south-1` (Mumbai)
    and confirm its current pricing.
  - Client IP trust (owner, 2026-11-22, from the Phase 7 report): set `TRUSTED_PROXIES` to the
    real proxy ranges, so the forwarded client IP (`CF-Connecting-IP` or `X-Forwarded-For`) is
    used only for requests from them: Cloudflare's published IPv4 and IPv6 ranges
    (cloudflare.com/ips) and Render's load-balancer addresses. Locally the list is empty, so the
    socket address is used. The mechanism ships in Phase 8.
