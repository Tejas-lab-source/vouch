# Threat model

- Status: Phase 14 security review (2026-11-23). Review again before launch and after any
  change to authentication, storage or the admin console.
- Scope: the API (`ROLE=all`, `api`, `ws`, `worker`), the web app, the mobile app, the admin
  console, Postgres, Redis and object storage, as deployed for the beta (one Render instance).

## Assets

| Asset                                          | Why it matters                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Students' profiles, photos and messages        | Personal data (DPDP). Messages are the most sensitive.            |
| ID-card and selfie images (verification)       | Identity documents; private bucket, short-lived signed URLs only. |
| College email (as a keyed hash only)           | Re-identification if the HMAC key leaks.                          |
| Sessions: access tokens, refresh tokens        | Account takeover.                                                 |
| Staff accounts (password + TOTP), admin tokens | Full moderation power: bans, unhides, photo decisions, flags.     |
| Signing keys, `EMAIL_HMAC_SECRET`, TOTP key    | Forging tokens, linking emails, bypassing staff MFA.              |
| The audit log                                  | Accountability for every staff action.                            |
| Safety state: blocks, reports, bans            | A failure here can expose a user to someone they blocked.         |

## Trust boundaries

1. **Internet → API and gateway.** Everything a client sends is untrusted: JSON bodies, query
   strings, path ids, socket payloads, file uploads (which go straight to storage through a
   presigned URL).
2. **Internet → object storage.** Clients PUT only to presigned URLs, with the content type
   and exact length signed. Reads of public photos go through the CDN. Private objects are
   readable only through signed URLs that expire in minutes.
3. **API → Postgres.** Each module uses its own database role (ADR 0004). A bug in one module
   cannot write another's tables.
4. **API → Redis.** Rate limits, presence, block cache and queues. No personal data beyond ids.
5. **API → providers.** Resend (email), Expo (push), Turnstile (captcha). These are fixed
   hosts. The server never fetches a URL a client supplies, so there is no SSRF surface.
6. **Staff → admin console.** A separate audience (`vouch:admin`) with password + TOTP, an
   optional IP allowlist, and a session checked on every request.

## Threats and controls (STRIDE)

| Threat                                     | Control                                                                                                                                  | Evidence                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **S** Forged or replayed tokens            | EdDSA only, `iss` and `aud` checked, `kid` key rotation with a grace window, 15-minute access tokens                                     | `test/platform/auth.test.js`                        |
| **S** Stolen refresh token                 | Rotation with reuse detection: reuse revokes the family                                                                                  | identity tests                                      |
| **S** Signed-out session still acting      | Sensitive routes check the session (ADR 0026); admin requests always do                                                                  | `phase14/sessions.integration.test.js`              |
| **S** Staff account takeover               | scrypt password + TOTP (one use per step), same error for every factor, 5 attempts per email, fail-closed limiter, optional IP allowlist | `phase10/admin.integration.test.js`                 |
| **T** Mass assignment, prototype pollution | Every body is a zod `strictObject`; unknown keys are refused                                                                             | `phase14/security.integration.test.js` (injection)  |
| **T** SQL injection                        | postgres.js tagged templates everywhere; the two `unsafe` calls use constants only                                                       | the injection test; code review                     |
| **T** Upload tampering                     | Presign signs type and exact size; confirm checks both; images re-encoded (EXIF and GPS stripped)                                        | media tests                                         |
| **R** Staff action without a trace         | Every staff change is audited in its own transaction (ADR 0025)                                                                          | `admin.integration.test.js` (failure injection)     |
| **I** Reading another user's data          | Every user route scopes by the caller; foreign ids answer 404 or 403                                                                     | the authz matrix and wrong-user tests               |
| **I** Read state leaks                     | Read receipts off by default and reciprocal (ADR 0024)                                                                                   | chat integration tests                              |
| **I** PII in logs                          | Pino redaction; logs carry ids, never emails, names, bodies or tokens                                                                    | `test/platform/logger.test.js`                      |
| **I** Cross-origin reads                   | CORS allowlist with credentials; refresh cookie `HttpOnly`, `Secure`, `SameSite=Strict`, path `/v1/auth/refresh`                         | the CORS test                                       |
| **D** Request flooding                     | Global per-user and per-IP limits (Redis); auth and OTP limits fail closed; 30 s request timeout                                         | rate-limit tests                                    |
| **D** Overload                             | 503 with `Retry-After` when the event loop, heap or in-flight requests are over their limits; health checks never shed (Phase 14)        | `test/platform/pressure.test.js`; the 10x load test |
| **D** Large payloads                       | 64 KB body limit (HTTP) and 16 KB message limit (socket), both added in Phase 14                                                         | the limits tests                                    |
| **E** User reaching admin routes           | Separate audience plus MFA claim plus a live session plus an active account plus a role per route                                        | the authz matrix                                    |
| **E** Module reaching another's data       | A database role per module; dependency-cruiser boundaries in CI                                                                          | `test/db/roles.test.js`, `pnpm check:boundaries`    |
| Supply chain                               | Lockfile, `pnpm audit --prod` in CI, install scripts blocked, pinned versions at least two weeks old                                     | CI                                                  |
| Leaked secrets                             | `.env` files never committed; `pnpm check:secrets --history` in CI                                                                       | CI                                                  |

## Phase 14 findings

| #   | Finding                                                                                                               | Severity            | Fix                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Read receipts were always on, revealing when a message was read                                                       | Privacy             | Off by default and reciprocal (ADR 0024)                                                                                              |
| 2   | An admin action could commit without its audit entry (separate transaction)                                           | High                | Same transaction through the outbox (ADR 0025)                                                                                        |
| 3   | Admin tokens could not be revoked; there was no logout                                                                | High                | Admin sessions checked on every request; logout route (ADR 0026)                                                                      |
| 4   | A signed-out user's access token could still export or delete data for up to 15 minutes                               | Medium              | Session check on sensitive routes (ADR 0026)                                                                                          |
| 5   | HTTP bodies up to 1 MB were accepted (the Fastify default)                                                            | Low                 | 64 KB limit                                                                                                                           |
| 6   | Socket messages up to 1 MB were buffered (the Socket.IO default)                                                      | Medium              | 16 KB limit; larger frames close the connection (this also reduces memory, see Phase 14 report)                                       |
| 7   | `pnpm audit --prod`: 4 moderate (`glob`, `minimatch`, transitive via `node-pg-migrate` and an OpenTelemetry detector) | Low                 | Overrides to the patched versions; audit clean; CI now runs the audit                                                                 |
| 8   | No secrets scan in CI                                                                                                 | Low                 | `scripts/secrets-scan.js`, run over every commit in CI; no findings in 170 commits                                                    |
| 9   | Under sustained overload the API ran out of heap and crashed, dropping every user (10x load test)                     | High (availability) | Load shedding: 503 with `Retry-After` under event-loop, heap or in-flight pressure; new sockets refused; V8 gets 75% of the container |

## Accepted risks

- **Rate limiting fails open when Redis is down.** The global limiter does this
  (`skipOnError`), so that a Redis blip does not take the app down. The limits that protect
  accounts fail closed when Redis is unavailable:
  - OTP request and verify
  - admin sign-in
  - the module limits marked fail-closed in their pipeline definitions
  - presigns, which are also capped by a per-user lock and the live-upload limit
- **Stateless access tokens on non-sensitive routes.** Browsing, swiping and chat accept a
  token for up to 15 minutes after its session is revoked. A ban or deletion closes sockets
  and conversations at once through events.
- **Single-region beta.** One instance and one database. This is covered by the restore and
  incident runbooks, not by redundancy.

## Before launch (security)

- A penetration test of the deployed beta (Phase 15 environment), including the admin
  console from outside the IP allowlist.
- Real keys rotated out of anything used in development, stored only in the host's secret
  store.
- Turn on `ADMIN_IP_ALLOWLIST` in production.
