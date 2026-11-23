# admin

The staff backend (ADR 0018): sign-in, the moderation routes, feature flags, the audit log and
admin panel definitions. Admin owns no business rules. It authenticates staff, checks roles,
calls the owning module's public API, and passes it the audit trail.

**Audit integrity (ADR 0025).** Every change is audited in the transaction that makes it:

- The owning module emits `audit.recorded.v1` through its outbox. Admin consumes the event and
  stores the row, idempotent on `auditId`.
- Admin's own changes (flags, sign-in) insert the row in their own transaction.

An action can never happen without its entry.

## Accounts

Created only by `pnpm --filter @vouch/api admin:create --email … --name … --role
moderator|admin`. The script stores:

- the email as an HMAC
- the password as a scrypt hash (from `ADMIN_CREATE_PASSWORD`, or generated and printed once)
- a new TOTP secret, encrypted with AES-256-GCM under `ADMIN_TOTP_KEY`

It prints the `otpauth://` URI once.

## HTTP routes (contracts in `packages/contracts/src/http/admin.js`)

Every route except sign-in needs a `vouch:admin` token with MFA, a live admin session (its `sid`
is checked in `admin.sessions` on every call), an active account (re-read on every call) and,
when set, an IP in `ADMIN_IP_ALLOWLIST`. Logout or revocation therefore takes effect at once
(Phase 14, ADR 0026).

| Route                                                  | Role                     | Audit action                                   |
| ------------------------------------------------------ | ------------------------ | ---------------------------------------------- |
| `POST /v1/admin/auth/login`                            | —                        | `admin.login`                                  |
| `POST /v1/admin/auth/logout`                           | any valid admin token    | `admin.logout`                                 |
| `GET /v1/admin/panels`                                 | moderator                | —                                              |
| `GET /v1/admin/reports`, `GET /v1/admin/reports/{id}`  | moderator                | —                                              |
| `POST /v1/admin/reports/{id}/actions`                  | moderator (`ban`: admin) | `report.<action>`                              |
| `GET /v1/admin/photo-reviews`                          | moderator                | —                                              |
| `POST /v1/admin/photo-reviews/{id}/decision`           | moderator                | `photo.approve` / `photo.reject`               |
| `GET /v1/admin/verification-reviews`                   | moderator                | —                                              |
| `POST /v1/admin/verification-reviews/{id}/decision`    | moderator                | `verification.approve` / `verification.reject` |
| `GET /v1/admin/users/{userId}`                         | moderator                | —                                              |
| `GET /v1/admin/bans`                                   | moderator                | —                                              |
| `POST /v1/admin/bans`, `POST /v1/admin/bans/{id}/lift` | admin                    | `ban.create`, `ban.lift`                       |
| `POST /v1/admin/users/{userId}/unblock`                | admin                    | `block.remove`                                 |
| `GET /v1/admin/audit-log`                              | admin                    | —                                              |
| `GET /v1/admin/flags`, `PUT /v1/admin/flags/{key}`     | admin                    | `flag.put` (+ `config.changed`)                |
| `GET /v1/admin/deletions/overdue`                      | admin                    | —                                              |

## Sign-in rules

- RFC 6238 TOTP: SHA-1, 30 s, 6 digits, ±1 step, compared in constant time.
- A code is accepted once: the last accepted step is stored.
- The same `UNAUTHENTICATED` answer whichever factor is wrong. The password is checked even
  for unknown emails.
- At most 5 attempts per email and 20 per IP in 15 minutes (fail closed).
- Tokens last `ADMIN_TOKEN_TTL_MINUTES` (60), with no refresh. Each sign-in creates a row in
  `admin.sessions` in the transaction that spends the code. Expired sessions are purged nightly.

## Audit log

One entry per change, written in the same transaction as the change (ADR 0025). It records the
actor, a dotted action,
the target type and id, and details. Details never contain staff notes or personal data.
Entries are append-only (`UPDATE` is revoked) and purged after 2 years (`admin.retentionTick`).

## Panels

Admin collects every module's `admin.panels` and returns those for the caller's role. Panels
come from:

- **safety:** reports, photo review, ID verification, bans
- **admin:** overdue deletions, feature flags, audit log

## Tables owned (schema `admin`)

`admin_users`, which also holds `password_hash` and `last_totp_step`, and `audit_log`. Admin
also reads `platform.colleges_v` and `platform.deletion_tasks`, and writes
`platform.feature_flags`.
