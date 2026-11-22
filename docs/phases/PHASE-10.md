## Phase 10 — Notifications, moderation and admin backend: Start Plan

Written under the owner's batch authorisation for Phases 9–13 (see `docs/PROGRESS.md`,
"Batch run"); no separate approval is awaited.

**Status of prerequisites:** Phases 1–8 approved ✅. Phase 9 is complete and pending owner
review, with CI green ([PHASE-09](PHASE-09.md), run 58).

**What I will build:**

1. **Contracts (additive only):**
   - Event `user.unbanned.v1` (safety).
   - Event `verification.decided.v1` (safety → identity).
   - Admin auth:
     - `POST /v1/admin/auth/login` (email, password and TOTP code); returns a `vouch:admin`
       token with `amr: ['pwd', 'otp', 'mfa']`
     - `POST /v1/admin/auth/logout`
   - Admin read routes:
     - `GET /v1/admin/panels`: the admin panel definitions from module manifests
     - `GET /v1/admin/deletions/overdue`: account deletions with a module not finished after
       24 h
   - `POST /v1/admin/users/{userId}/unblock`: removes a block (from the Phase 7 notes).
   - ID-card fallback:
     - `POST /v1/verification/id-card/uploads`: signed upload URLs for the ID and the selfie
     - `POST /v1/verification/id-card`: submits them for review
   - `requestOtp` and `verifyOtp` gain the optional fields `verification: 'id_card'` and
     `signup.collegeId`.
   - Jobs:
     - `notifications.likesDigest`
     - `notifications.retentionTick`
     - `safety.retentionTick`
     - `admin.retentionTick`
     - `platform.consistencyCheck`
     - `media.reviewAlert`
   - Env:
     - `ADMIN_TOTP_KEY`
     - `ADMIN_TOKEN_TTL_MINUTES` (60)
     - `PUSH_PROVIDER` (`dev` or `expo`) and `EXPO_ACCESS_TOKEN` (optional)
     - `REPORT_AUTOHIDE_REPORTERS` (3) and `REPORT_AUTOHIDE_DAYS` (7)
     - `PUSH_MESSAGE_BATCH_SECONDS` (30)
     - `ADMIN_ALERT_EMAIL` (optional)
     - `ID_CARD_FALLBACK` (on)
     - `PHOTO_REJECTIONS_FOR_REVIEW` (3)
2. **`modules/notifications`:**
   - A `PushProvider` port, with two adapters:
     - an Expo adapter over plain `fetch`: chunks of 100, tickets stored, receipts checked by
       `notifications.checkReceipts`, `DeviceNotRegistered` tokens removed through identity
     - a development adapter that logs a token hash, never the token
   - A templates registry (manifest key `templates`): `match.new`, `message.new` and
     `likes.digest`. Template text never contains a message body or a name.
   - Consumers:
     - `match.created.v1`: push to `firstLikerId`
     - `message.created.v1`: push only if the recipient is still offline, at most one push per
       conversation per 30 s (later messages are logged as `suppressed`)
     - `report.created.v1`: email `ADMIN_ALERT_EMAIL` through an `EmailSender` port (Resend or
       console), with ids only
     - `user.blocked.v1`: a pair cancel marker that pending `sendPush` jobs check, so no push
       goes between the pair
   - Preferences and quiet hours (time-zone aware; a window may wrap midnight) mark a push
     `suppressed`. Every attempt is logged in `deliveries`.
   - `PUT /v1/me/notification-prefs`.
   - A daily `likes.digest` for users with unanswered likes.
   - Delivery retention: 90 days.
3. **`modules/safety` part 2:**
   - **Reports:** `report` stores an evidence snapshot: the profile card, plus the last 20
     messages for chat reports, membership-checked through chat's API. It emits
     `report.created.v1` and is rate-limited.
   - **Auto-hide:** at 3 distinct reporters in 7 days, the profile is hidden through profiles'
     API.
   - **Actions:** warn, hide, unhide and ban; lifting a ban.
     - A ban emits `user.banned.v1`. Identity revokes sessions and sets `banned`; discovery
       already filters out bans; chat closes conversations, telling the banned user `banned`
       and the other person `unmatched`.
     - Lifting a ban emits `user.unbanned.v1`; identity sets the account back to `active`.
   - **ID-card verification reviews:** the images are private objects under `verification/`
     (never on the CDN), signed URLs last 5 minutes, and the images are deleted 30 days after
     the decision. A decision emits `verification.decided.v1`; identity activates or rejects
     the account.
   - **The photo review queue** over media's API (`listInReview`, `resolveReview`), plus the
     48-hour `in_review` alert (a metric and an error log).
   - **Repeat offences:** counted from `photo.rejected.v1`. At `PHOTO_REJECTIONS_FOR_REVIEW`,
     a system report enters the queue.
   - Report evidence is purged 1 year after close; bans are removed once lifted or expired.
4. **Identity:**
   - The ID-card sign-up path (status `pending_review`). Pending users can only use the
     verification routes.
   - The `user.unbanned.v1` and `verification.decided.v1` consumers.
   - Ban evasion: when a banned account is erased, a minimal `identity.banned_emails`
     record (the email HMAC and the ban expiry) is kept, and sign-up refuses that email with
     `ACCOUNT_BANNED`.
   - API additions: `pushTokensOf`, `removePushToken`, `getUserByPublicId` and status details.
5. **`modules/admin`:**
   - Accounts are created only by `pnpm admin:create`, which hashes the password with scrypt,
     generates a TOTP secret encrypted with AES-256-GCM under `ADMIN_TOTP_KEY`, and prints
     the `otpauth://` URI once.
   - Login: TOTP per RFC 6238 (`node:crypto`, ±1 step, replay refused), rate-limited per email
     and IP, generic errors.
   - Every admin route needs:
     - the `vouch:admin` audience with `mfa`
     - an active account, checked on every request, so disabling takes effect at once
     - an allowed IP when `ADMIN_IP_ALLOWLIST` is set
   - Every contract admin route, plus the new ones. Every action writes one `audit_log`
     entry.
   - Panel definitions (manifest key `admin.panels`) from safety, media, identity and
     platform.
   - Flags: list and edit, with `config.changed` broadcast to every socket. Also
     `GET /v1/config`, the platform route still missing.
   - Audit retention: 2 years.
6. **Consistency job** (`platform/jobs/consistency.js`, nightly). It counts:
   - matches without conversations, and conversations without matches
   - deleted users with remaining rows in any module
   - deletions not finished within 24 h, read from each module's inbox record of
     `user.deleted.v1`

   Each count goes to a gauge `vouch_consistency_violations{check}`, with an error log above 0.

**Out of scope:** the admin frontend (Phase 13), email digests, marketing notifications, and
web push.

**Dependencies:** none new (`node:crypto`, `fetch`).

**How I will verify it:**

- Unit tests: TOTP against the RFC 6238 vectors, quiet hours, templates and auto-hide.
- Integration tests:
  - Notifications: a match gives one push to the right user; an offline message gives one
    push; quiet hours suppress; 5 messages collapse into 1 push; an invalid token is removed.
  - Safety: 3 reports auto-hide a profile; a ban revokes sessions, removes the user from decks
    and closes conversations within one consumer cycle.
  - Admin: a user token is rejected on admin routes; every action writes exactly one audit
    entry.
  - Deletion leaves no rows except anonymised matches, confirmed by the consistency job.
  - The ID-card fallback, end to end.
- The full backend scenario through `inject` plus sockets: sign-up → profile → photos
  approved → deck → match → chat → push → report → ban.
- An endpoint-coverage test: every contract endpoint is registered and has a test.
- Notification timing p95.
- Then every check, a clean clone, repeated runs, mutation checks, the Docker image and CI.

**Branch:** `claude/lucid-rubin-foq2uj` (ADR 0002); one PR for Phases 9–13 at the end.

---

## Phase 10 — Notifications, moderation and admin backend: Completion Report

**Summary:** The backend is feature-complete for v1.

- **Notifications:** offline users get push notifications for matches and messages, with
  preferences, time-zone-aware quiet hours, 30-second message batching and block
  cancellation. A push never carries a message body or a name.
- **Moderation:** staff sign in with email, password and TOTP, work reports (evidence
  snapshots, auto-hide), photo reviews and ID-card verifications, ban and lift bans, edit
  flags and read the audit log.
- **Consistency:** a nightly check counts cross-module consistency violations; account
  erasure is tracked per module.

**Completion criteria:**

- [x] **The full backend scenario test passes:** sign-up → profile → photos approved → deck →
      match → chat → push → report → ban.
  - Evidence: `test/modules/phase10/scenario.integration.test.js`, through `inject` plus
    sockets with no shortcuts (log below).
  - The same flow ran against the Docker image (transcript below).
- [x] **Every v1 endpoint in `openapi.json` is implemented and contract-tested:** all 45
      contract endpoints are registered (the scenario test checks `hasRoute` for each one).
  - Each endpoint has at least one test that calls it (coverage table below).
  - Every route serialises its response through the contract schema.
- [x] **Every module has a complete README:**
  - new: notifications, admin
  - updated: safety, identity, chat, matching, profiles, media, discovery

**Owner guidance, as implemented:**

| Guidance                                                                                | Where and test                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Expo push over HTTPS, chunks of 100, receipts, invalid tokens removed                   | `notifications/adapters/push/expo.js`; unit tests (250 messages → 100/100/50), "invalid token removed" |
| No message bodies in payloads                                                           | Templates; unit test and the integration and scenario checks that no body reaches a push               |
| Admin accounts by script only                                                           | `scripts/admin-create.js` (also in the Docker image); there is no sign-up route                        |
| TOTP with `node:crypto`; secret encrypted at rest; audience `vouch:admin`; IP allowlist | `admin/domain/totp.js` (RFC 6238 vectors), AES-256-GCM, platform auth                                  |
| ID-card fallback                                                                        | Identity sign-up + safety review; "ID-card fallback" integration test                                  |
| `user.unbanned.v1` and the unban flow                                                   | Ban lift and nightly expiry; identity reactivates; integration test                                    |
| Ban evasion across deletion                                                             | `identity.banned_emails`; unit test                                                                    |
| Moderation queue using `resolveReview`                                                  | Photo review queue; integration test                                                                   |
| 48-hour `in_review` alert                                                               | `media.reviewAlert` (hourly) → `vouch_photo_reviews_overdue` and an error log                          |
| Auto-hide at 3 distinct reporters in 7 days (configurable)                              | `REPORT_AUTOHIDE_*`; integration test (3 by one person and 2 others do not; a third does)              |
| Every admin action writes `audit_log`                                                   | One entry per action; integration test (and reads write none)                                          |
| Bans close conversations with `unmatched` for the other person                          | Matching ends matches; chat notices; scenario and safety tests                                         |
| Phase 14 note on gateway memory                                                         | Recorded in `docs/PROGRESS.md` (owner, during Phase 10)                                                |

**What was built:**

- **Contracts (additive):**
  - 6 endpoints: admin login, panels, overdue deletions, unblock, and the two ID-card routes
  - optional `verification` and `signup.collegeId` on sign-in
  - `selfieImageUrl` on verification reviews
  - 2 events (`user.unbanned.v1`, `verification.decided.v1`)
  - 6 jobs
  - the `safety.reportEvidence` pipeline
  - 11 env vars

  `contracts:diff` reports no breaking changes.

- **`modules/notifications`:** push provider (Expo and log), templates, consumers, preferences,
  quiet hours, batching, block cancellation, receipts, the digest, retention and the export.
- **`modules/safety` part 2:** reports and evidence, auto-hide, actions, bans and expiry,
  ID-card reviews, the photo review queue, repeat offences, erasure, retention and panels.
- **`modules/admin`:** sign-in, per-call account and role checks, every admin route, the audit
  log, panels, flags and retention; `scripts/admin-create.js`.
- **Identity:**
  - the ID-card sign-up, and the `pr` claim
  - ban, unban and verification consumers
  - `banned_emails`
  - push-token, `deletedBefore` and status APIs
- **Other modules:**
  - **media:** review queue listing, private `verification/` objects, the review alert
  - **profiles:** hide, unhide, `statusOf`
  - **matching:** a ban ends matches; `pendingLikes`
  - **chat:** the evidence step
- **Platform:**
  - `GET /v1/config`
  - `jobs/consistency.js`
  - `user.deleted.v1` completion in `deletion_tasks`, purged after 90 days
  - the consumer-transaction semaphore
  - socket `broadcast`
  - gauges
  - template and panel registries
  - job queues from the contracts
  - the pending-review route gate (HTTP and socket handshake)
- **Migrations (expand-only):**
  - `identity_banned_emails`
  - `upload_review_queue`
  - `safety_moderation`
  - `admin_auth`
  - `platform_consistency_grants`

**Endpoints and events, implemented and tested:**

| Area                     | Endpoints / events                                                                                                                           | Tests                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Notifications            | `PUT /v1/me/notification-prefs`; consumes `match.created`, `message.created`, `user.blocked`, `report.created`, `user.deleted`               | `phase10/notifications.integration` (7), unit (11) |
| Reports and ID-card      | `POST /v1/reports`, `POST /v1/verification/id-card/uploads`, `POST /v1/verification/id-card`; emits `report.created`, `verification.decided` | `phase10/safety.integration` (7)                   |
| Admin sign-in and access | `POST /v1/admin/auth/login`, `GET /v1/admin/panels`                                                                                          | `phase10/admin.integration` (9), admin unit (11)   |
| Admin moderation         | reports (list, get, act), photo reviews (list, decide), verification reviews (list, decide), users, bans (list, create, lift), unblock       | admin, safety and scenario integration tests       |
| Admin operations         | audit log, flags (list, put), overdue deletions                                                                                              | admin and scenario integration tests               |
| Platform                 | `GET /v1/config`                                                                                                                             | admin integration (signed in and signed out)       |
| Bans                     | emits `user.banned`, `user.unbanned`; consumed by identity, matching, chat                                                                   | safety and scenario integration tests              |
| Deletion                 | `user.deleted.v1` in 6 consumers, recorded in `deletion_tasks`                                                                               | scenario (deletion), consistency job               |
| Phases 5–9 endpoints     | unchanged                                                                                                                                    | their suites, all passing                          |

**Full scenario log** (`PHASE10_SCENARIO`, `pnpm test`):

```
sign-up: asha active, kabir active
profiles: both active with 2 approved photos each
deck: asha sees Kabir and likes; kabir sees Asha
match: 01a202db…, match.new on kabir's socket
push: match.new to asha (first liker)
chat: 2 messages; push message.new to asha (batched, no body)
report: 01a202dc… open; staff alerted by email (ids only)
ban: kabir banned (sessions revoked, refresh 401); asha told "unmatched", kabir "banned"; out of decks; sending refused
audit: admin.login, report.ban
routes: all 45 contract endpoints registered
deletion: every consumer finished (chat, matching, media, notifications, profiles, safety)
consistency: {"matches_without_conversation":0,"conversations_without_match":0,"deleted_users_with_data":0,"deletions_overdue":0}
overdue deletions: listed only when a module has not finished
```

**Notification timing** (message sent → push handed to the provider, 20 samples, local stack):
`PHASE10_PUSH_TIMING {"samples":20,"p50Ms":174,"p95Ms":195}`, and in a second run
`{"p50Ms":182,"p95Ms":194}`.

**Configuration values (defaults):**

| Setting                                                   | Default                                              | Meaning                                                  |
| --------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `PUSH_MESSAGE_BATCH_SECONDS`                              | 30                                                   | At most one message push per conversation in this window |
| Receipt check                                             | 15 min                                               | `notifications.checkReceipts` after a send               |
| Block cancel marker                                       | 1 h                                                  | Queued pushes between the pair are cancelled             |
| Likes digest                                              | 12:53 UTC                                            | 18:23 IST, daily                                         |
| `REPORT_AUTOHIDE_REPORTERS` / `REPORT_AUTOHIDE_DAYS`      | 3 / 7                                                | Distinct reporters that hide a profile pending review    |
| `REPORTS_PER_DAY`                                         | 20                                                   | Reports one user may file a day                          |
| `PHOTO_REJECTIONS_FOR_REVIEW`                             | 3 (30 days)                                          | Moderation rejections that open a system report          |
| Photo review alert                                        | 48 h, hourly                                         | `vouch_photo_reviews_overdue`                            |
| `ID_CARD_FALLBACK`                                        | true                                                 | Any email plus a reviewed student ID and selfie          |
| ID-card signed URLs / image retention                     | 5 min / 30 days after the decision                   | Private `verification/` prefix                           |
| `ADMIN_TOKEN_TTL_MINUTES`                                 | 60                                                   | Admin tokens; no refresh                                 |
| Admin sign-in limits                                      | 5 per email, 20 per IP / 15 min                      | Fail closed                                              |
| TOTP                                                      | SHA-1, 30 s, 6 digits, ±1 step, single use           | RFC 6238                                                 |
| Audit log / deliveries / report evidence / deletion tasks | 2 y / 90 d / 1 y after close / 90 d after completion | Nightly purges                                           |
| Consistency check                                         | 04:37 UTC                                            | `vouch_consistency_violations{check}`                    |
| Consumer transactions at once                             | ½ of `DATABASE_POOL_MAX` (5)                         | The deadlock fix                                         |
