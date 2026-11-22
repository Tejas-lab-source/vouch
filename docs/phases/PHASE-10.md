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
