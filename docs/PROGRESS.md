# Progress

Status values: `Not started`, `Plan sent`, `In progress`, `Report sent`, `Approved`.
See `docs/ROADMAP.md` Part A for the approval protocol.

| #   | Phase                                                                   | Status                          | Start approved     | Completed approved | Report             |
| --- | ----------------------------------------------------------------------- | ------------------------------- | ------------------ | ------------------ | ------------------ |
| 1   | Repository foundation and tooling                                       | Approved                        | 2026-11-21         | 2026-11-21         | phases/PHASE-01.md |
| 2   | Database architecture and migrations                                    | Approved                        | 2026-11-21         | 2026-11-21         | phases/PHASE-02.md |
| 3   | API, event and socket contracts                                         | Approved                        | 2026-11-21         | 2026-11-21         | phases/PHASE-03.md |
| 4   | Backend platform kernel                                                 | Approved                        | 2026-11-21         | 2026-11-21         | phases/PHASE-04.md |
| 5   | Identity and authentication                                             | Approved                        | 2026-11-21         | 2026-11-22         | phases/PHASE-05.md |
| 6   | Profiles, media and photo pipeline                                      | Approved                        | 2026-11-22         | 2026-11-22         | phases/PHASE-06.md |
| 7   | Safety core and discovery engine                                        | Approved                        | 2026-11-22         | 2026-11-22         | phases/PHASE-07.md |
| 8   | Matching                                                                | Approved                        | 2026-11-22         | 2026-11-22         | phases/PHASE-08.md |
| 9   | Realtime chat                                                           | Complete — pending owner review | 2026-11-22 (batch) | —                  | phases/PHASE-09.md |
| 10  | Notifications, moderation and admin backend                             | Not started                     | —                  | —                  | —                  |
| 11  | Frontend foundation                                                     | Not started                     | —                  | —                  | —                  |
| 12  | Frontend features I (onboarding, profile, discovery, matching)          | Not started                     | —                  | —                  | —                  |
| 13  | Frontend features II (chat, notifications, safety, settings, admin app) | Not started                     | —                  | —                  | —                  |
| 14  | End-to-end testing, security, privacy and performance                   | Not started                     | —                  | —                  | —                  |
| 15  | Deployment, observability and closed beta launch                        | Not started                     | —                  | —                  | —                  |

## Batch run: Phases 9–13

**Authorisation (owner, 2026-11-22, verbatim intent):** a direct owner instruction that overrides
Part A.1 (per-phase approval) for Phases 9, 10, 11, 12 and 13 only. Every other rule in
`docs/ROADMAP.md` and `CLAUDE.md` still applies. Phase 14 and later return to normal: after
Phase 13, stop and wait for "Approved: start Phase 14".

**How the batch runs:**

1. Strictly in order, 9 → 10 → 11 → 12 → 13, one at a time, never skipping.
2. For each phase: write the Start Plan into `docs/phases/PHASE-NN.md` (no waiting); build to
   the roadmap scope plus its "Notes for later phases"; verify everything (lint, format,
   typecheck, boundaries, both contract checks, all tests, clean clone, repeated runs, mutation
   checks, Docker checks; every check unpiped or with `set -o pipefail`); push and wait for CI
   green on the phase's final commit before the next phase; write the Completion Report (D.2)
   into `PHASE-NN.md`; mark the phase "Complete — pending owner review"; continue.
3. Focused Conventional Commits per phase. Never rewrite pushed history, force-push or merge.
4. At the end: one PR "Phases 9–13 — Chat, notifications, admin backend and frontend" linking
   all five reports, then a final summary, then stop.
5. No questions during the batch. Decisions: the most secure and privacy-preserving, simplest,
   within the approved stack, consistent with ARCHITECTURE.md and earlier ADRs; contract
   changes additive only. Each recorded in an ADR and listed under "Decisions taken without the
   owner" in that phase's report.
6. **Stop and wait only if:** a real account, credential, API key, payment or paid service is
   needed; a breaking contract change, destructive migration or change to an approved security
   or privacy rule seems necessary; CI or a check stays red after 3 serious fix attempts; an
   action would merge to main, force-push, delete branches or touch production; or the roadmap
   and ARCHITECTURE.md conflict in a way that changes product scope. Then write the blocker
   here, commit a clean state and stop.

**Dependencies:** pre-approved: the approved stack (B.2); `socket.io@4.8.4`,
`@socket.io/redis-adapter@8.3.0`, `@socket.io/redis-emitter@5.1.0`, `socket.io-client@4.8.4`;
official Expo SDK and Expo-recommended React Native packages; React, Vite, React Router,
TanStack Query; Playwright, `@axe-core/playwright`, Testing Library; one list-virtualisation
library and one gesture/animation library that Expo supports. Anything else only if
well-maintained, widely used and clearly necessary, justified in an ADR and listed in the
report. Prefer `node:crypto` and plain `fetch` over SDKs (TOTP, Expo push).

**Phase 9 decisions:**

- First task: a readable message for every `AppErrorCode` from Phases 3–8, plus a test that
  fails if any code lacks one or just repeats the code.

1. Additive client event `auth.refresh { token }`: the server verifies it and extends the
   socket's expiry without disconnecting. Only if no valid refresh arrives by expiry plus a
   60 s grace, disconnect with `token_expired`; the client reconnects and syncs. Test both.
2. Spread socket disconnects over about 20 s within `SHUTDOWN_DRAIN_MS`.
3. `@socket.io/redis-emitter` for worker roles.
4. Conversation id = match id, created by the consumer or on first send.
5. At most 2 links per message, none in a sender's first 3 messages per conversation, both
   configurable, rejected with a readable `MESSAGE_REJECTED` reason.
6. 60 messages per minute per user, failing open.
7. The blocker gets reason `blocked`; the other person gets `unmatched` for blocks and bans
   (moderation is never revealed); deletion sends `deleted`; sending to any closed conversation
   returns `CONVERSATION_CLOSED`. Test that a blocked or banned user's `conversation.closed` is
   identical to an ordinary unmatch.
8. Ack after commit, best-effort live delivery, replay through `sync`, proven by the failover
   invariant.

- Targets: failover invariant exactly-once and in order; 500-socket smoke with zero loss;
  delivery p95 under 1 s.

**Phase 10 guidance:** Expo push over plain HTTPS (chunks of 100, receipts, invalid tokens
removed; payloads never contain message bodies). Admin accounts created by a script only; admin
MFA is TOTP (RFC 6238) with `node:crypto`, secret encrypted at rest; audience `vouch:admin`;
optional IP allowlist. Include the Phase 10 notes (ID-card fallback, `user.unbanned.v1`, ban
evasion across deletion via a minimal ban record keyed on the email HMAC, the moderation queue
using `media.resolveReview`, the 48-hour `in_review` alert). Auto-hide at 3 distinct reporters in
7 days (configurable). Every admin action writes `audit_log`. Bans close conversations with
reason `unmatched` for the other person.

**Phases 11–13 guidance:** brand not decided: name "Vouch", neutral accessible placeholder
palette and type scale in `packages/ui-tokens`, light and dark themes. Include the Phase 11/12
and 13 notes (likes count, photo reordering, client resizing to 2048 px, real-photo variant
sizes if possible, R2 CORS documented and applied locally on SeaweedFS, blocked-users list and
unblock routes). Web push out of scope unless no new dependency. Mobile: no simulators here, so
the Expo app must build and type-check, shared logic is tested in `packages/features-core`, web
flows run in Playwright where possible, and the Phase 12 and 13 reports carry an "Owner manual
checks" list. Accessibility: axe, no serious violations. Web bundle: initial JS under 200 KB
gzipped.

**Running log** (updated as the batch goes; resume from the last row after an interruption):

| Phase | Status                          | Last commit | CI run                                                                          | Next step                      |
| ----- | ------------------------------- | ----------- | ------------------------------------------------------------------------------- | ------------------------------ |
| 9     | Complete — pending owner review | `f8519dd`   | [run 58](https://github.com/Tejas-lab-source/vouch/actions/runs/44996401012) ✅ | Phase 10 start plan            |
| 10    | In progress                     | —           | —                                                                               | Start plan, then notifications |
| 11    | Not started                     | —           | —                                                                               | —                              |
| 12    | Not started                     | —           | —                                                                               | —                              |
| 13    | Not started                     | —           | —                                                                               | —                              |

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
- **Phase 12 — likes count (owner, 2026-11-22, Phase 8 plan):** add
  `GET /v1/me/likes/count` (additive) over matching's `likesIn` use case (a count only, never
  identities).
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
  - Chat (from the Phase 9 report): re-measure gateway memory per socket on Render (about
    0.8 MB per socket under load locally).
- **Phases 11–13 — chat clients (from the Phase 9 report):** live delivery is best effort.
  After every (re)connect, a client must send `sync` with its last seq per conversation,
  merge messages by `(conversationId, seq)`, and send `auth.refresh` before the access token
  expires (the server disconnects 60 s after expiry with `auth.expired`).
