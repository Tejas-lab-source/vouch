# 0011 — Token strategy and identity rate limits

- Status: Accepted (by owner on 2026-11-21, Phase 5 start plan)
- Phase: 5

## Context

Vouch is passwordless: a 6-digit code goes to a college email (ARCHITECTURE.md 8.3, 11.1).
Sessions must survive app restarts for weeks, detect stolen refresh tokens, and work for both
mobile (no cookies) and web (cookies, CSRF). OTP endpoints attract brute force and email
bombing. Campuses usually sit behind one shared public IP (NAT).

## Decision

**Access tokens**

- EdDSA (Ed25519) JWTs, 15 minutes, signed with the active key (`JWT_ACTIVE_KID`) from
  `JWT_SIGNING_KEYS`.
- Claims: `iss` = `vouch`; `aud` = `vouch:user` (admin tokens use `vouch:admin`); `sub` = the
  caller's own internal user id (never another user's, never used in URLs); `sid` = the session
  id.
- Key rotation by `kid`: a retired key keeps verifying for 15 minutes after its `retiredAt`, one
  access-token lifetime. This was the owner's Phase 4 decision, replacing ARCHITECTURE 11.1's 24
  hours.

**Refresh tokens**

- 32 random bytes (base64url), valid 30 days. Only the SHA-256 hash is stored, in
  `identity.auth_sessions`.
- One session per sign-in per device. Every refresh rotates the token: the old session is marked
  `replaced_by` the new one, in the same `family_id`.
- Reuse detection:
  - Presenting a rotated token revokes the whole family and returns `REFRESH_TOKEN_REUSED`.
  - A token revoked by logout, device sign-out, a ban or deletion is simply
    `REFRESH_TOKEN_INVALID`.
- Transport:
  - **Mobile:** in the JSON body.
  - **Web:** a cookie named `vouch_refresh` with `HttpOnly`, `Secure`, `SameSite=Strict` and
    `Path=/v1/auth/refresh`, omitted from the body. `SameSite=Strict` together with the narrow
    path keeps the cookie off every other request (CSRF).
- Verify and refresh are not replayed through the idempotency store, so refresh tokens never sit
  in Redis.

**Rate limits** (fixed windows in Redis, all configurable through env):

| Limit                                | Default                                   | Variable                                               |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------ |
| OTP requests per email               | 3 per 15 min, 10 per day                  | `RATE_LIMIT_OTP_EMAIL_15M`, `RATE_LIMIT_OTP_EMAIL_DAY` |
| OTP requests per device (`deviceId`) | 5 per hour                                | `RATE_LIMIT_OTP_DEVICE_HOUR`                           |
| OTP requests per IP                  | 300 per hour                              | `RATE_LIMIT_OTP_IP_HOUR`                               |
| Verify attempts per IP               | 300 per 15 min (plus 5 attempts per code) | `RATE_LIMIT_VERIFY_IP_15M`                             |
| Refreshes per session family         | 60 per hour                               | `RATE_LIMIT_REFRESH_SESSION_HOUR`                      |

- **Shared campus IPs:** a campus usually reaches the internet through one NAT address, so
  thousands of students can share an IP. Per-IP limits are therefore set high, and only stop
  floods from one address. The per-email limits (plus Turnstile and the 5-attempt cap per code)
  and the per-device limits do the fine-grained work.
- **Fail closed for OTP requests:** if Redis or the rate limiter is unavailable, `POST /v1/auth/otp`
  refuses with `TEMPORARILY_UNAVAILABLE` (503) and sends no code. Verify and refresh also return
  503 when Redis is down, because they need it. Other routes' global limiter keeps failing open.

## Alternatives considered

- **Long-lived access tokens without refresh:** no revocation, and no theft detection.
- **Session cookies for mobile too:** awkward on React Native, and no benefit over the body.
- **`sub` = `public_id`:** a lookup on every request to map it back to the internal id.
- **Low per-IP limits:** one student could lock out a whole campus.

## Consequences

- A revoked session's access token stays valid until it expires (up to 15 minutes). Routes that
  must not tolerate that (for example registering a push token) check the session itself.
- Theft detection can sign out a legitimate user whose app retried a refresh after a network
  failure; they simply sign in again.
- `pnpm dev:keys` creates local keys; production keys are generated the same way and stored in
  the host's secret store (Phase 15).
