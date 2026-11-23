# 0018 — Admin backend: staff sign-in, roles and the audit log

- Status: Accepted (taken under the owner's batch authorisation for Phases 9–13; listed in the
  Phase 10 report under "Decisions taken without the owner")
- Phase: 10

## Context

Staff moderate reports, photos and ID cards, ban users and edit feature flags. The roadmap
requires a separate audience claim, MFA, an optional IP allowlist, an audit entry for every
action, and that staff read chats only through a report's evidence. The owner asked for TOTP
with `node:crypto` (no SDK), with the secret encrypted at rest, and for admin accounts to be
created only by a script.

## Decision

- **Accounts:** `pnpm --filter @vouch/api admin:create --email … --name … --role
moderator|admin` is the only way to create one. There is no sign-up route.
  - The email is stored as an HMAC (the same secret and normalisation as identity).
  - The password is stored as a scrypt hash (N = 2^15, r = 8, p = 1). It comes from
    `ADMIN_CREATE_PASSWORD`, never a command-line flag, or is generated and printed once.
  - The TOTP secret (20 random bytes) is encrypted with AES-256-GCM under `ADMIN_TOTP_KEY`.
    The script prints the `otpauth://` URI once.
- **Sign-in** (`POST /v1/admin/auth/login`) takes email + password + TOTP:
  - TOTP follows RFC 6238: SHA-1, 30 s steps, 6 digits, ±1 step. Every candidate is compared
    in constant time.
  - **Replay:** the accepted step is stored (`last_totp_step`), and a code is accepted only if
    its step is newer.
  - The password is checked even for unknown emails, so timing reveals nothing.
  - Every failure answers the same `UNAUTHENTICATED` message.
  - Rate limits fail closed: 5 per email and 20 per IP in 15 minutes.
  - `ADMIN_IP_ALLOWLIST` applies to sign-in as well as every admin route.
- **Tokens:** EdDSA, audience `vouch:admin`, `amr` `[pwd, otp, mfa]`, the role, and a lifetime
  of `ADMIN_TOKEN_TTL_MINUTES` (60). There is no refresh token: staff sign in again.
- **Every call** checks:
  - the token's audience and MFA (the use-case chain)
  - that the account is still `active` (re-read on every call, so disabling it takes effect at
    once)
  - the role
- **Roles:**
  - Moderators handle reports (dismiss, warn, hide, unhide), photo reviews and ID reviews.
  - Admins can also ban (directly or through a report), lift bans, unblock, edit flags, read
    the audit log and see overdue deletions.
- **Audit:** every action writes exactly one `admin.audit_log` entry after it succeeds: actor,
  dotted action, target and details. Details never hold the staff note or anything personal.
  Notes stay on the report. Reads write nothing. Sign-in is audited as `admin.login`.
- **Panels:** modules declare `admin.panels` in their manifests. `GET /v1/admin/panels` returns
  the ones the caller's role may use, normalised through the contract schema. Phase 13 renders
  them generically.
- **Flags:** `PUT /v1/admin/flags/{key}` stores the flag, clears the flag cache and broadcasts
  `config.changed` to every socket. `GET /v1/config` (Phase 10) evaluates flags for the caller.

## Alternatives considered

- **Email OTP plus TOTP:** sign-in would depend on email delivery.
- **WebAuthn:** strongest, but it needs a browser flow and more code than Phase 10 allows.
  Recorded as a follow-up.
- **Audit in the same transaction as the action:** actions run in other modules'
  transactions under other roles. Auditing after success means a crash in between can leave
  an action unaudited. That is rare, and it is logged. An audit entry for an action that
  then failed would be worse.

## Consequences

- Losing `ADMIN_TOTP_KEY` means re-enrolling every staff member. It must be backed up with the
  other production secrets (Phase 15).
- Staff sessions last at most an hour, and disabling an account takes effect on the next call.
