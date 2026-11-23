# Progress

Status values: `Not started`, `Plan sent`, `In progress`, `Report sent`, `Approved`.
See `docs/ROADMAP.md` Part A for the approval protocol.

| #   | Phase                                                                   | Status      | Start approved           | Completed approved | Report             |
| --- | ----------------------------------------------------------------------- | ----------- | ------------------------ | ------------------ | ------------------ |
| 1   | Repository foundation and tooling                                       | Approved    | 2026-11-21               | 2026-11-21         | phases/PHASE-01.md |
| 2   | Database architecture and migrations                                    | Approved    | 2026-11-21               | 2026-11-21         | phases/PHASE-02.md |
| 3   | API, event and socket contracts                                         | Approved    | 2026-11-21               | 2026-11-21         | phases/PHASE-03.md |
| 4   | Backend platform kernel                                                 | Approved    | 2026-11-21               | 2026-11-21         | phases/PHASE-04.md |
| 5   | Identity and authentication                                             | Approved    | 2026-11-21               | 2026-11-22         | phases/PHASE-05.md |
| 6   | Profiles, media and photo pipeline                                      | Approved    | 2026-11-22               | 2026-11-22         | phases/PHASE-06.md |
| 7   | Safety core and discovery engine                                        | Approved    | 2026-11-22               | 2026-11-22         | phases/PHASE-07.md |
| 8   | Matching                                                                | Approved    | 2026-11-22               | 2026-11-22         | phases/PHASE-08.md |
| 9   | Realtime chat                                                           | Approved    | 2026-11-22 (batch)       | 2026-11-23         | phases/PHASE-09.md |
| 10  | Notifications, moderation and admin backend                             | Approved    | 2026-11-22 (batch)       | 2026-11-23         | phases/PHASE-10.md |
| 11  | Frontend foundation                                                     | Approved    | 2026-11-22 (batch)       | 2026-11-23         | phases/PHASE-11.md |
| 12  | Frontend features I (onboarding, profile, discovery, matching)          | Approved    | 2026-11-22 (batch)       | 2026-11-23         | phases/PHASE-12.md |
| 13  | Frontend features II (chat, notifications, safety, settings, admin app) | Approved    | 2026-11-22 (batch)       | 2026-11-23         | phases/PHASE-13.md |
| 14  | End-to-end testing, security, privacy and performance                   | Approved    | 2026-11-23 (batch rules) | 2026-11-23         | phases/PHASE-14.md |
| 15  | Deployment, observability and closed beta launch                        | In progress | 2026-11-23               | —                  | phases/PHASE-15.md |

## Phase 15 run (owner, 2026-11-23)

**Approval:** "Approved: start Phase 15". Normal per-phase rules apply. When the phase is
complete (the launch checklist fully ticked), send the Completion Report and stop.

**Dependencies approved** (exact versions, at least two weeks old): `wrangler`, `eas-cli`,
`@sentry/react`, `@sentry/react-native`, `@sentry/vite-plugin`.

**Owner decisions:**

1. **Domain:** bought on Cloudflare Registrar; the name is not sent yet. Build with a
   placeholder (`example.app`) and wait for the real name only at the deploy step.
2. **Staging:** the smallest plans (about $13 a month), synthetic data only.
3. **Email:** Resend.
4. **Monitoring:** Sentry and Grafana Cloud free tiers.
5. **First campus:** JIIT Noida, invite-only with invite codes. The exact student email
   domain is not sent yet (a placeholder until then).

**Rules for this run:**

- Build everything that does not need owner items first.
- When blocked, name the exact checklist item and stop.
- **Never ask for a secret in chat:** the owner enters secrets into Render or GitHub.

The owner is working through items A1–A3 now.

## Phase 14 approval and the beta plan (owner, 2026-11-23)

**Approval:** "Approved: Phase 14 complete." PR #10 was merged by the owner. Phase 15 follows
the normal per-phase rules again: send the Start Plan and wait for "Approved: start Phase 15".

**Beta hosting decision (ADR 0028):**

| Component | Plan                         | Resources       |
| --------- | ---------------------------- | --------------- |
| API       | Render web service, Standard | 1 CPU, 2 GB     |
| Postgres  | Render Postgres, Basic-1gb   | 0.5 CPU, 1 GB   |
| Redis     | Render Key Value, Starter    | persistence off |

- **Measured at the beta peak on this plan:**
  - no errors
  - HTTP p95 26–37 ms, deck p95 45 ms, message delivery p95 69 ms
  - API CPU 21% of a core on average, Postgres 9%
- **The assumed plan** (Starter API, Postgres Basic-256mb) failed 37% of requests at the same
  load.
- **Stepping the API down to Starter later** is allowed if production metrics show headroom
  (criteria in ADR 0028).

## Phase 14 run (owner, 2026-11-23)

**Owner decisions:** "Approved: Phases 9–13 complete." PR #9 was merged by the owner. All
decisions taken without the owner in Phases 9–13 are accepted, except the changes listed below,
which Phase 14 makes.

**Authorisation:** "Approved: start Phase 14", with the same batch rules as Phases 9–13 (below):
write the plan into `docs/phases/PHASE-14.md` without waiting, no questions, decide by the same
rules, record every decision, stop only for the listed reasons. **Phase 15 returns to normal:**
after Phase 14, stop and wait for "Approved: start Phase 15".

**Phase 14 tasks, in addition to its roadmap scope and the notes below:**

1. **Privacy fix (first):** a "Share read receipts" setting, off by default and reciprocal (a
   user sees others' read receipts only if they share their own). Additive contract change, a
   settings row on web and mobile, tests that receipts are never sent when either side has it
   off, and an ADR.
2. **Audit integrity:** every admin action and its `audit_log` entry are written in the same
   transaction (or via the outbox), so an action can never happen without its audit entry. A
   test simulates a failure between them.
3. **Admin sessions:** an admin logout route and immediate revocation of admin sessions, checked
   on every admin request. Also the recorded session-revocation check for sensitive user routes.
4. **Gateway memory per socket:** investigate and fix toward under 100 KB per idle socket.
5. **Swipe performance:** profile the mobile swipe gesture. If it cannot reliably hold 60 fps on
   the JS thread, switch to `react-native-gesture-handler` + `react-native-reanimated`
   (pre-approved), with an ADR. Add the 60 fps check to the owner's manual list either way.
6. **Before launch:** list every remaining placeholder that must be real before launch
   (grievance contact, privacy notice text, terms, support email, brand, mobile `apiUrl`) in a
   "Before launch" section of the Phase 14 report.

**At the end:** open a PR "Phase 14 — Testing, security, privacy and performance", send the
owner its summary (what was tested, k6 results, chaos results, security and privacy findings,
anything needing the owner's decision) and stop.

**Running log:**

| Step                                      | Status                                   | Last commit                     | CI run                                             | Next step                                     |
| ----------------------------------------- | ---------------------------------------- | ------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Phase 14                                  | Approved (2026-11-23), PR #10 merged     | —                               | —                                                  | Phase 15 Start Plan sent                      |
| 1 Read receipts                           | Done                                     | `50498ca`                       | —                                                  | Audit integrity                               |
| 2 Audit integrity                         | Done                                     | `39a75e4`                       | —                                                  | Admin sessions                                |
| 3 Admin sessions and sensitive routes     | Done                                     | `c092dbe`                       | green                                              | Security review                               |
| 4 Security review                         | Done                                     | `34b9b24`, `8781c23`            | red, then green (the scan flagged its own fixture) | Gateway memory                                |
| 5 Gateway memory                          | Done                                     | `edc5bf5`                       | —                                                  | Coverage and invariants                       |
| 6 Coverage and invariants                 | Done                                     | `a173f1f`                       | —                                                  | Privacy                                       |
| 7 Privacy, runbooks, swipe, accessibility | Done                                     | `a1118c4`, `c904cd6`, `6cc23b0` | —                                                  | Load test                                     |
| 8 Load, performance fixes, chaos          | Done                                     | `56ac7f9`, `d14ddac`, `e51ea87` | —                                                  | 20 invariant runs, report, PR                 |
| 9 Report, PR                              | Done: report sent; waiting for the owner | (this commit)                   | see the PR                                         | Owner review; then "Approved: start Phase 15" |

**Decisions taken without the owner (Phase 14):**

- The read-receipts commit is marked `feat(chat)!` by mistake. It is a behaviour change, not a
  contract break (the contract change is additive). History is not rewritten.
- Audit integrity uses the outbox (ADR 0025). Each module emits `audit.recorded.v1` in the
  transaction that makes the change, and admin stores it idempotently. A multi-step action
  (for example, a report resolved with a ban) writes one entry per change.
- The audit helper lives in `platform/uow.js`, which application code may already import, so
  the module-boundary rules are unchanged.
- The migrations test now lists the Phase 14 chat migration (`4868beb`). The Task 1 commit had
  missed it.
- **Read receipts:** the setting is its own chat endpoint, not a notification-prefs field as
  the start plan said. Notifications depends on chat; the reverse would be a module cycle
  (ADR 0024).
- **Sensitive routes** that check the session (ADR 0026):
  - device list, sign-out and push token; deletion; export; safety's self-unblock
  - a repeated deletion needs no live session
- **The security review** added a 64 KB HTTP body limit and a 16 KB socket message limit,
  `glob` and `minimatch` overrides (audit clean), and an in-repo secrets scan. The gitleaks
  image was blocked by the network, and running an unvetted npx package over the history was
  refused here.
- **Deletion** now tombstones the deleted member in chat conversations, as matching does.
  The consistency check covers every user-id column (a schema test keeps it complete).
- **Safety's export:** your blocks, the reports you filed, and your verification status.
  Never reports about you.
- **The privacy notice** is a versioned, structured draft marked "pending legal review". The
  default version is `2026-11-draft`, and the clients refuse consent to a version they cannot
  show.
- **The swipe** moved to Gesture Handler 3.3.0, Reanimated 4.7.1 and Worklets 0.13.0 (Expo SDK
  58's pins), as pre-approved (ADR 0027).
- **The load test** runs `NODE_ENV=development`, because production refuses the dev
  providers. The beta plan is assumed to be: API 0.5 CPU / 512 MB, Postgres 0.1 CPU / 256 MB,
  Redis 256 MB.
- **Overload protection** (found by the 10x run, where the API ran out of heap):
  - 503 with `Retry-After` when the mean event-loop delay is over 250 ms, the heap is over
    85%, or 128 requests are in flight
  - new sockets refused under the same conditions
  - V8 gets 75% of the container
- **Synchronous pipeline steps run without a timer.** This cut API CPU by about a third.
- **Two invariant timing targets each failed once** under noise: lock-hold p95 20.8 ms, and
  load-smoke delivery p95 1,071 ms. The targets are kept. Fixes:
  - concurrent checks under the swipe lock
  - concurrent lookups in a chat send
  - the likes invariant runs the REST role only, so later phases' consumers do not skew its
    lock timing (Phase 8's isolation)
  - the 20-run count restarted after each change

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

| Phase | Status                | Last commit     | CI run                                                                          | Next step                                     |
| ----- | --------------------- | --------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| 9     | Approved (2026-11-23) | `f8519dd`       | [run 58](https://github.com/Tejas-lab-source/vouch/actions/runs/44996401012) ✅ | Phase 10 start plan                           |
| 10    | Approved (2026-11-23) | `62e108d`       | [run 68](https://github.com/Tejas-lab-source/vouch/actions/runs/45017563607) ✅ | —                                             |
| 11    | Approved (2026-11-23) | `d0c3b16`       | [run 74](https://github.com/Tejas-lab-source/vouch/actions/runs/45055946738) ✅ | —                                             |
| 12    | Approved (2026-11-23) | `9875936`       | [run 82](https://github.com/Tejas-lab-source/vouch/actions/runs/45061138745) ✅ | —                                             |
| 13    | Approved (2026-11-23) | (report commit) | see the PR                                                                      | Owner review; then "Approved: start Phase 14" |

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
- **Phase 14 — gateway memory per socket (owner, 2026-11-22, from the Phase 9 report):**
  - Investigate gateway memory per socket: Phase 9 measured about 350–380 MB with 250 sockets
    (about 0.8 MB per socket), against the design assumption of about 30 KB.
  - Measure idle sockets separately from the load test's own overhead.
  - Check per-message compression and buffer settings.
  - Target: under 100 KB per idle socket, so a 512 MB beta server can hold the expected 600
    concurrent sockets.
  - Report the findings and any fix.
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
- **Post-launch — socket load under overload (owner, 2026-11-23, approved follow-up from the
  Phase 14 report):** shed or limit socket message load under overload, the way HTTP returns a
  quick 503. At 10x on the assumed beta plan, chat acks took 35–42 s because `message.send` is
  not shed. Use the same pressure signal (`platform/pressure.js`), and answer
  `TEMPORARILY_UNAVAILABLE` so clients retry with backoff.
- **Phases 11–13 — chat clients (from the Phase 9 report):** live delivery is best effort.
  After every (re)connect, a client must send `sync` with its last seq per conversation,
  merge messages by `(conversationId, seq)`, and send `auth.refresh` before the access token
  expires (the server disconnects 60 s after expiry with `auth.expired`).
