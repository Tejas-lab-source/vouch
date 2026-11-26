# identity

Sign-up and sign-in with a college-email one-time code, sessions with rotating refresh tokens,
devices, consent records, account deletion and data export.

## Public API (`api.js`)

| Function                         | Returns                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `getUser(id)`                    | `{ id, publicId, collegeId, status, birthDate }` or `null`                             |
| `getUsersByIds(ids)`             | The same view for many users                                                           |
| `getUsersByPublicIds(publicIds)` | The same view, looked up by public id                                                  |
| `assertActive(id)`               | Throws `FORBIDDEN` unless `active` (`ACCOUNT_PENDING_REVIEW` while an ID review waits) |
| `deletedBefore(cutoff, limit)`   | Accounts deleted before `cutoff`, not yet erased (overdue deletions, Phase 10)         |
| `pushTokensOf(userId)`           | Push tokens of the user's signed-in devices (Phase 10)                                 |
| `removePushToken(token)`         | Forgets a token the push provider reported invalid                                     |

## HTTP routes (contracts in `packages/contracts/src/http/identity.js`)

| Route                        | Auth   | Use case                                                                 |
| ---------------------------- | ------ | ------------------------------------------------------------------------ |
| `POST /v1/auth/otp`          | public | `requestOtp`: fails closed when Redis or the rate limiter is unavailable |
| `POST /v1/auth/verify`       | public | `verifyOtp`: signs in, or signs up with `signup`                         |
| `POST /v1/auth/refresh`      | public | `refresh`: rotation with reuse detection and a 30 s retry grace window   |
| `POST /v1/auth/logout`       | user   | `logout`: revokes this session's family                                  |
| `GET /v1/me/devices`         | user   | `listDevices`                                                            |
| `DELETE /v1/me/devices/{id}` | user   | `revokeDevice`: remote sign-out                                          |
| `POST /v1/devices`           | user   | `registerDevice`: push token for the current device                      |
| `DELETE /v1/me`              | user   | `deleteAccount`                                                          |
| `GET /v1/me/export`          | user   | `exportData`: identity plus every module's `exports` hook                |

**Sensitive routes (Phase 14, ADR 0026):** an access token stays valid for up to 15 minutes
after its session is revoked. So these routes also check the session itself (`sessions.isLive`):

- the routes: devices (list, sign out, push token), deletion, export, and safety's
  `DELETE /v1/blocks/{userId}` (via `requireLiveSession` in identity's API)
- a session is live when it is not revoked, or when it was only rotated by a refresh and its
  family is still live
- a revoked session gets `UNAUTHENTICATED`
- a repeated deletion answers the same result without the check

## Events

- **Emits:** `user.created.v1` (on sign-up), `user.deleted.v1` (on deletion, once).
- **Consumes:**
  - `user.banned.v1`: revokes every session, sets the status to `banned` and keeps the email
    HMAC in `banned_emails` while the ban lasts (ban evasion across deletion, Phase 10)
  - `user.unbanned.v1`: `banned` → `active`; the record goes
  - `verification.decided.v1`: an approved ID-card review activates a `pending_review`
    account

## Jobs

- **`identity.retentionTick`** (nightly, 03:41 UTC) enqueues `identity.retention` for three
  tasks: sessions expired or revoked more than 30 days ago, devices revoked more than 30 days
  ago, and accounts deleted more than 30 days ago (erasure).

## Tables owned (schema `identity`)

`users`, `devices`, `auth_sessions`, `consents`, `banned_emails`, `invite_codes`. View:
`identity.active_users_v`.
No plaintext email is stored: `email_hmac` is HMAC-SHA256 of the normalised address.

## Redis keys

- `identity:otp:{emailHmacHex}`: the hashed code and its attempt count, kept 10 minutes.
- `platform:rl:identity:*`: this module's rate-limit counters.

## Rules

- **Email:** trimmed, lowercased, `+tag` dropped. The domain must exactly match one listed in
  `platform.colleges.email_domains`; no subdomains, because alumni and staff often use them.
- **OTP:** 6 digits from `crypto.randomInt`, stored as an HMAC. It is valid 10 minutes, with
  5 attempts, and compared in constant time. `SIGNUP_DETAILS_REQUIRED` neither consumes the code
  nor counts an attempt.
- **Age:** 18 or older on the day of sign-up. An under-18 attempt stores nothing.
- **Tokens:** see ADR 0011.

## ID-card sign-up (Phase 10, ADR 0020)

- `requestOtp` and `verifyOtp` with `verification: 'id_card'` accept any email (when
  `ID_CARD_FALLBACK` is on) and need `signup.collegeId`. The account starts `pending_review`.
- Its access tokens carry `pr: true`. The platform then allows only the routes in
  `PENDING_REVIEW_ROUTES` (the verification uploads, devices, logout, deletion, export and
  config). The socket handshake is refused.
- After approval, the next refresh issues a token without the claim.
- A new sign-up whose email belongs to an erased account still under an active ban gets
  `ACCOUNT_BANNED`, and the code is consumed.

## Invite-only colleges (Phase 15)

- A college is invite-only while the `beta.invite_only` flag is on and its campus rule lists
  the college. `scripts/college-add.js --invite-only` adds the college to the rule.
- A new account at such a college needs `signup.inviteCode`: `INVITE_CODE_REQUIRED` when it
  is missing, `INVITE_CODE_INVALID` when it is unknown, revoked, expired, used up or for
  another college. Both are checked before the OTP is consumed, so the client retries with
  the same code. Existing accounts sign in without one.
- `identity.invite_codes` stores SHA-256 hashes of the normalised code (80 random bits, Crockford
  base32, `XXXX-XXXX-XXXX-XXXX`). The use is counted in the sign-up transaction
  (`UPDATE … WHERE uses < max_uses`), and `users.invite_code_id` records which code admitted
  the account. `scripts/invite-create.js` prints new codes once.

## Adapters

| Port              | Production adapter                                                  | Development adapter                                                                        |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `EmailProvider`   | Resend (HTTP, 5 s timeout)                                          | console: logs the code with an email-HMAC prefix, never the address; refused in production |
| `CaptchaVerifier` | Turnstile (HTTP, 5 s timeout; a network failure means not verified) | always passes; refused in production                                                       |
