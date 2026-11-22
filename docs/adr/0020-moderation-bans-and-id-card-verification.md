# 0020 — Moderation, bans and the ID-card fallback

- Status: Accepted (taken under the owner's batch authorisation for Phases 9–13; listed in the
  Phase 10 report under "Decisions taken without the owner")
- Phase: 10

## Context

Phase 10 adds safety part 2: reports with evidence, auto-hide, moderation actions, bans, the
ID-card verification fallback, the photo review queue and repeat-offence counting. It must keep
the earlier rules:

- a block or ban is never revealed (Phase 9)
- staff read chats only through a report
- a banned user who deletes their account must not come back with the same email (owner,
  Phase 5)

## Decision

- **Evidence without a module cycle:** chat already depends on safety, so a chat report's
  evidence comes from a new fail-closed pipeline, `safety.reportEvidence`, that chat
  contributes to. Chat's step returns the last 20 messages only when the reporter and the
  target are that conversation's two members. Otherwise it refuses with `NOT_A_MEMBER`.
  Profile reports keep the profile card.
- **Auto-hide:** after a report, if `REPORT_AUTOHIDE_REPORTERS` (3) distinct people reported
  the target within `REPORT_AUTOHIDE_DAYS` (7), profiles hides the profile. Staff unhide
  through the report. Users may file `REPORTS_PER_DAY` (20) reports a day.
- **Actions:**
  - dismiss and warn (recorded only; the warning reaches the user in a later phase)
  - hide and unhide (profiles API)
  - ban, which is admin-only
- **Bans** emit `user.banned.v1`. On that event:
  - identity revokes every session and sets the account to `banned`
  - matching ends every active match (`unmatchedBy: null`)
  - chat's existing unmatch consumer closes the conversations, so the other person is told
    `unmatched` and the banned user `banned`
  - discovery already drops banned users at read time

  Lifting a ban, or the nightly expiry, emits the new `user.unbanned.v1`. Identity then
  reactivates the account. Matches stay ended.

- **Ban evasion:** while a ban is active, identity keeps `identity.banned_emails` (the email
  HMAC, the ban id and the expiry, no user id). A sign-up with that email gets
  `ACCOUNT_BANNED`. Only the code holder learns this, and the code is consumed. The row goes
  when the ban is lifted or expires.
- **ID-card fallback:**
  - `requestOtp` and `verifyOtp` accept `verification: 'id_card'` with any email (gated by
    `ID_CARD_FALLBACK`, on by default), plus `signup.collegeId`. The account is created
    `pending_review`.
  - The student gets presigned PUT URLs for an ID photo and a selfie under the private
    `verification/` prefix (never `photos/`, never the CDN), then submits.
  - Staff see 5-minute signed URLs.
  - A decision emits the new `verification.decided.v1`. Identity activates an approved
    account. After a rejection the student may submit again.
  - Images are deleted 30 days after the decision.
- **Pending accounts reach only verification routes:** their access tokens carry `pr: true`.
  The platform refuses every other signed-in route, and the socket handshake, with
  `ACCOUNT_PENDING_REVIEW`. The allowed routes are the verification routes, their own devices
  and session, deletion, export and `GET /v1/config`. No database lookup is needed per
  request. After approval, the next token refresh drops the claim.
- **Photo review queue:** media lists `in_review` photos with signed URLs. `resolveReview`
  decides. A photo waiting more than 48 hours sets `vouch_photo_reviews_overdue` and logs an
  error (hourly `media.reviewAlert`).
- **Repeat offences:** `photo.rejected.v1` with reason `moderation` is counted.
  `PHOTO_REJECTIONS_FOR_REVIEW` (3) in 30 days opens one system report (a fixed system
  reporter id) while none is open.
- **Erasure:** on `user.deleted.v1`, safety erases blocks, ID reviews and images, and offence
  counts. Reports stay as moderation records (1 year after close). An active ban stays, so
  the account cannot come back.
- **Deletion tracking:** the kernel records each consumer's `user.deleted.v1` completion in
  `platform.deletion_tasks`, in the consumer's transaction. Staff see erasures not finished
  within 24 hours, and the nightly consistency job counts them.

## Alternatives considered

- **Safety depends on chat:** a cycle (chat checks blocks through safety).
- **A per-request status lookup for pending accounts:** one more query on every request.
- **Keeping ban evasion in safety's tables:** safety would have to keep the email HMAC, which
  only identity should hold.

## Consequences

- A student is approved only after refreshing their token (the clients do this on launch and
  on `config.changed`).
- Reports outlive erased accounts. Their users appear as `erased-account-0000` to staff.
