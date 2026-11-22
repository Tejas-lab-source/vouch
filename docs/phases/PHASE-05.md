## Phase 5 — Identity and authentication module: Completion Report

**Summary:** Students sign up and sign in with a one-time code sent to their college email. They
receive a 15-minute EdDSA access token and a 30-day refresh token that rotates on every use,
with reuse detection. They can list and remotely sign out devices, register a push token, log
out, delete their account and export their data. OTP requests fail closed when Redis or the rate
limiter is unavailable. Every flow runs through `fastify.inject` and through curl against a real
`ROLE=all` process.

**Completion criteria:**

- [x] **Sign-up, sign-in, refresh, logout, device revoke, delete and export work** through
      `fastify.inject` (`identity.integration.test.js`) and through curl against `ROLE=all`
      (transcript below).
- [x] **No PII appears in a captured log sample.** The integration test captures all logs at
      debug level and finds no email, code or JWT; the curl run's log has 0 occurrences of the
      test email.
- [x] **The module README is complete:** `apps/api/src/modules/identity/README.md`.

**Owner items and decisions:**

| Item                           | How it was met                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:keys` (item 1)       | `scripts/dev-keys.js`: print, `--write`, `--rotate`; refuses `NODE_ENV=production`. Node built-ins only, so CI runs it before installing; tested                                                                                         |
| OTP fails closed (item 2)      | Redis or limiter down → 503 `TEMPORARILY_UNAVAILABLE`, no email sent. Tested with fakes and with Redis paused; `GET /v1/me/devices` keeps working (fail open)                                                                            |
| Decision 1: additive contracts | `POST /v1/auth/logout`, `GET /v1/me/devices`, `DELETE /v1/me/devices/{id}`, `TEMPORARILY_UNAVAILABLE` (503), optional `deviceId`, `identity.retention`. `contracts:diff` passes                                                          |
| Decision 2: claims             | `sub` = the caller's internal user id, plus `sid`                                                                                                                                                                                        |
| Decision 3: status             | `active` after verify; the ID-card fallback route is deferred to Phase 10                                                                                                                                                                |
| Decision 4: email              | Trim, lowercase, drop `+tag`; exact domains only. `alumni.<college domain>` is rejected (domain, use-case and HTTP tests)                                                                                                                |
| Decision 5: deletion window    | `FORBIDDEN` ("This account is being deleted.") until erasure                                                                                                                                                                             |
| Decision 6: email provider     | Resend adapter (`fetch`, 5 s timeout); the console adapter is refused in production by the env schema                                                                                                                                    |
| Decision 7: rate limits        | OTP: 3 per 15 min and 10 per day per email, 5 per hour per device, 300 per hour per IP. Verify: 300 per 15 min per IP. Refresh: 60 per hour per session. All configurable through `RATE_LIMIT_*`; shared-campus-IP reasoning in ADR 0011 |
| Decision 8: ban                | `user.banned.v1` revokes every session and sets status `banned`. Tested through the real relay                                                                                                                                           |
| Decision 9: dev keys           | As described; `.env.example` keeps a public-only key                                                                                                                                                                                     |

**Route table:**

| Method and path              | Auth                          | Success                         | Endpoint-specific errors                                                                                                                                                |
| ---------------------------- | ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/otp`          | public                        | 200 `{ sent: true }`            | CAPTCHA_FAILED 400, EMAIL_DOMAIN_NOT_ALLOWED 422, TEMPORARILY_UNAVAILABLE 503                                                                                           |
| `POST /v1/auth/verify`       | public                        | 200 `{ tokens, user }`          | OTP_INVALID 400, OTP_EXPIRED 400, OTP_ATTEMPTS_EXHAUSTED 429, SIGNUP_DETAILS_REQUIRED 422, UNDERAGE 422, ACCOUNT_BANNED 403, FORBIDDEN 403, TEMPORARILY_UNAVAILABLE 503 |
| `POST /v1/auth/refresh`      | public (body token or cookie) | 200 `{ tokens }`                | REFRESH_TOKEN_INVALID 401, REFRESH_TOKEN_REUSED 401, ACCOUNT_BANNED 403, TEMPORARILY_UNAVAILABLE 503                                                                    |
| `POST /v1/auth/logout`       | user                          | 200 `{ loggedOut: true }`       | —                                                                                                                                                                       |
| `GET /v1/me/devices`         | user                          | 200 `{ items }`                 | —                                                                                                                                                                       |
| `DELETE /v1/me/devices/{id}` | user                          | 200 `{ revoked: true }`         | NOT_FOUND 404                                                                                                                                                           |
| `POST /v1/devices`           | user                          | 200 `{ registered: true }`      | —                                                                                                                                                                       |
| `DELETE /v1/me`              | user                          | 202 `{ deleted, erasureDueBy }` | —                                                                                                                                                                       |
| `GET /v1/me/export`          | user                          | 200 `{ generatedAt, data }`     | —                                                                                                                                                                       |

Every route can also return VALIDATION_FAILED 400, APP_VERSION_UNSUPPORTED 426, RATE_LIMITED 429
and INTERNAL 500. User routes add UNAUTHENTICATED 401 and ACCOUNT_BANNED 403.

**Token lifetimes and rate limits** (ADR 0011):

| Item                | Value                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Access token        | 15 minutes, EdDSA, `aud` vouch:user, claims `sub` and `sid`                                   |
| Refresh token       | 30 days, rotated on every use, stored as SHA-256; reuse of a rotated token revokes the family |
| Retired signing key | Still verifies for 15 minutes                                                                 |
| Web cookie          | `vouch_refresh`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/v1/auth/refresh`             |
| OTP                 | 6 digits, valid 10 minutes, 5 attempts, stored as an HMAC                                     |
| OTP request limits  | 3 per 15 min and 10 per day per email; 5 per hour per device; 300 per hour per IP             |
| Verify limit        | 300 per 15 min per IP                                                                         |
| Refresh limit       | 60 per hour per session                                                                       |

**Tests and validation** (clean clone; Node v24.22.3, pnpm 10.34.9):

```
pnpm lint / format:check / typecheck / check:boundaries / contracts:check   → all exit 0
pnpm contracts:diff --base origin/main  → No breaking contract changes against origin/main.
pnpm test                               → 33 s
  @vouch/contracts  Tests 364 passed
  @vouch/config     Tests 4 passed
  @vouch/api        Tests 206 passed (27 files) · src/platform lines 98.29%
```

The API suite also passed two more consecutive runs (206/206 each).

Identity tests:

- **Domain (18):**
  - normalisation, including `+tag` and malformed addresses
  - exact domain matching (alumni and staff subdomains rejected)
  - the 18th-birthday boundary and leap days
  - OTP rules and refresh classification
- **Use cases with fakes (19):**
  - happy path, wrong code, attempts exhausted, expired code, under-18, notice version
  - banned or being-deleted accounts
  - fail closed on the limiter and on the OTP store
  - limit keys and values
  - refresh rotation and reuse, logout, devices, push token, deletion emitted once, export
- **Integration (12, Testcontainers):**
  - the full OTP → `SIGNUP_DETAILS_REQUIRED` (code kept) → sign-up → refresh cycle; responses
    validated against the contracts
  - reuse revokes the family; cookie attributes
  - two devices, remote sign-out, push token, logout
  - deletion emits `user.deleted.v1` once and blocks re-sign-up
  - export contains no email; the ban consumer works through the relay
  - alumni subdomain rejected
  - an admin-audience token is rejected on user routes; a retired key is rejected after its
    grace
  - every rate limit triggers at its threshold; the defaults are the approved values
  - OTP fails closed with Redis paused while another route works
  - the retention job purges
  - no PII in logs
- **Scripts (4):** generated keys validate, sign and verify; rotation; `.env` updates; a
  public-only active key is refused for signing.

Mutation checks (reverted afterwards):

| Mutation                            | Result       |
| ----------------------------------- | ------------ |
| No family revocation on reuse       | 2 tests fail |
| Deleted accounts allowed to sign in | 2 tests fail |

curl against `ROLE=all` (Docker Compose, `pnpm db:seed`, `pnpm dev:keys --write`):

```
1)  POST /v1/auth/otp                    → {"sent":true}
2)  POST /v1/auth/verify (no signup)     → {"error":{"code":"SIGNUP_DETAILS_REQUIRED",…}}
3)  POST /v1/auth/verify (with signup)   → {"user":{"userId":"1Lq80Q6Dk6yOokYqGsl63A","status":"active","newUser":true},"tokens":[accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt]}
4)  POST /v1/auth/refresh                → new token pair
5)  POST /v1/auth/refresh (old token)    → "REFRESH_TOKEN_REUSED" (family revoked)
6)  GET  /v1/me/devices                  → [{"platform":"ios","current":true}]
7)  POST /v1/devices                     → UNAUTHENTICATED (correct: step 5 revoked this session's family)
8)  GET  /v1/me/export                   → identity: [account, consents, devices, email]
9)  POST /v1/auth/logout                 → {"loggedOut":true}
10) DELETE /v1/me                        → 202 {"deleted":true,"erasureDueBy":"2026-12-22T00:00:54.890Z"}
11) POST /v1/auth/otp (alumni subdomain) → "EMAIL_DOMAIN_NOT_ALLOWED"
```

Push-token registration on a live session is covered by the integration test. After this run,
readable messages were added for every identity error code: step 2 returned the bare code as
its message.

Sample log lines from that run (redacted by design: no email, only an HMAC prefix; the code
appears only in the development console adapter, which production refuses):

```
{"level":30,…,"emailHmacPrefix":"31ee7fb8","devOtp":"<6 digits>","msg":"development email: sign-in code"}
{"level":30,…,"req":{"method":"POST","url":"/v1/auth/verify","host":"127.0.0.1:3000",…},"msg":"incoming request"}
{"level":30,…,"code":"SIGNUP_DETAILS_REQUIRED","status":422,"msg":"request rejected"}
```

The test email appears in 0 log lines.

Docker, using the CI steps (now with `node scripts/dev-keys.js --write`): migrations from the
image, `/health` ok, `/ready` ready, `POST /v1/auth/otp` → `{"sent":true}`, `docker stop` → exit 0.

**Decisions made:** [ADR 0011 — Token strategy and identity rate limits](../adr/0011-token-strategy.md)

**Deviations from the roadmap:**

- **`ServiceError` in `@vouch/contracts`:** a pure coded error class. Use cases throw it, because
  B.4 bars application layers from `platform/errors.js`. The kernel's `AppError` extends it.
- **Kernel additions:**
  - `platform/rate-limit.js` (fail-closed mode) and `platform/routes.js` (contract → route)
  - registry `exports` collection and the manifest key `schedules` (module cron jobs). The
    roadmap's manifest key list did not include schedules.
- **The idempotency store returns `TEMPORARILY_UNAVAILABLE`** instead of a 500 when Redis is down.
- **Verify and refresh are not replayed through the idempotency store,** so refresh tokens never
  sit in Redis. A retried verify fails because its code is consumed; a retried refresh is
  handled by the reuse rules.
- **Only rotated tokens count as reuse.** Tokens revoked by logout, device sign-out, a ban or
  deletion return `REFRESH_TOKEN_INVALID`, not `REFRESH_TOKEN_REUSED`.
- **Readable messages:** the kernel's error messages now cover every identity code.

**Known issues and risks:**

- **Revoked sessions:** their access tokens stay valid until they expire (up to 15 minutes).
  `POST /v1/devices` checks the session itself; read routes rely on the short lifetime.
- **Retried refreshes:** reuse detection can sign out a user whose app retried a refresh after
  a network failure. They sign in again.
- **Ban evasion:** a banned user can delete their account and, after 30 days, sign up again with
  the same email. Ban evasion across deletions is Phase 10's to handle.
- **Development console adapter:** it logs codes, by design and for local use only. The env
  schema refuses it in production.
- **No real-provider test:** Resend and Turnstile were not exercised against the real services,
  which need keys. Their adapters use `fetch` with timeouts, and fall back to "not verified" on a
  network failure.

**Suggested follow-ups (not done, need approval):**

1. Phase 10: ID-card fallback route, admin login with MFA, and `user.unbanned.v1` with status
   restore.
2. Phase 14: consider a session-revocation check (Redis denylist) for sensitive routes.

**How you can check it yourself:**

```bash
cp .env.example .env && pnpm dev:keys --write && docker compose up -d --wait && pnpm db:migrate && pnpm db:seed
```

```bash
cd apps/api && node --env-file=../../.env src/main.js
```

```bash
curl -s -H 'content-type: application/json' -H 'x-app-version: 1.0.0' -H 'idempotency-key: demo-0001' \
  -d '{"email":"you@northfield.example.edu","turnstileToken":"dev"}' localhost:3000/v1/auth/otp
```

The code appears in the server log (`devOtp`). Then verify with that code and a `signup` object;
see the route table.

**CI run:** https://github.com/Tejas-lab-source/vouch/actions/runs/44964867873 (both jobs green on `601fa50`, the last code commit).

**Pull request:** opened from `claude/lucid-rubin-foq2uj` into `main`, titled "Phase 5 — Identity
and authentication module" · Branch: `claude/lucid-rubin-foq2uj` (ADR 0002)

⏸️ I have stopped. Reply "Approved: Phase 5 complete" to close this phase.
I will not start Phase 6 until you approve its start plan.
