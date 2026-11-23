# 0026 — Admin sessions and session checks on sensitive routes

- Status: Accepted (owner instruction, Phase 14). Extends ADR 0011 (user sessions) and ADR 0018
  (admin sign-in).
- Phase: 14

## Context

Access tokens are stateless JWTs:

- **Users:** a user token lasts 15 minutes. After logout, a device sign-out or a ban, the token
  keeps working until it expires.
- **Staff:** an admin token lasted 60 minutes. There was no logout and no way to revoke it,
  short of disabling the account.

The owner asked for:

- an admin logout
- immediate revocation of admin sessions, checked on every admin request
- the recorded session check for sensitive user routes

## Decision

### Admin sessions

- **Created at sign-in:** each sign-in creates an `admin.sessions` row and puts its id in the
  token (`sid`). The row is written in the transaction that spends the TOTP code and writes
  the `admin.login` audit entry.
- **Checked on every admin request:** every admin use case checks that the session exists,
  belongs to the staff member, is not revoked and has not expired. A token without `sid`
  (signed before this change) is refused.
- **Logout:** `POST /v1/admin/auth/logout` (additive contract change) revokes the session. It
  is idempotent and writes `admin.logout` in the same transaction.
  - The admin console calls it before forgetting the token.
- **Revoking all of a staff member's sessions:** done in the database
  (`UPDATE admin.sessions SET revoked_at = now() WHERE admin_id = …`). Disabling the account
  also works at once, because the account status is re-read on every call.
- **Retention:** expired sessions are purged nightly by `admin.retentionTick`.
- **Cost:** one indexed primary-key read per admin request. Staff traffic is tiny.

### Sensitive user routes

- **The routes:**
  - device list, remote sign-out and push-token registration
  - account deletion and data export
  - safety's self-unblock, which removes a protection
- **The check:** these routes also check the session (`identity.sessions.isLive`). A revoked
  session gets `UNAUTHENTICATED`, and the client then refreshes. The refresh fails, so the
  client signs out.
- **When a session is live:**
  - it is not revoked, or
  - it was only rotated by a refresh and its family still has a live session. Every
    revocation (logout, device sign-out, ban, deletion, reuse detection) revokes all live rows
    of the family, user or device, so this rule is exact.
- **Repeated deletion:** a repeated `DELETE /v1/me` (a retry after deletion, when every session
  is revoked) answers the same result without the check, and changes nothing.
- **Other modules** call `identity.requireLiveSession(ctx)`.
- **Everything else** stays stateless, as in ADR 0011:
  - browsing, swiping and chat accept a valid access token until it expires (at most
    15 minutes)
  - sockets are dropped on ban or deletion by their own consumers

## Consequences

- A stolen access token can no longer export or delete data, or change devices, once its
  session is signed out.
- A stolen admin token is useless as soon as the staff member signs out or the session is
  revoked.
- **Tests:**
  - `test/modules/phase14/sessions.integration.test.js`: every sensitive route is refused after
    logout; refresh keeps both tokens working; a device sign-out stops them; admin logout,
    expiry and revocation each take effect on the next request
  - the identity unit tests cover the same rules with fakes
