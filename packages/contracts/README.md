# @vouch/contracts

Every v1 boundary of Vouch, as zod schemas. Backend and frontend both build against this
package, so it is the single definition of what crosses a process or network boundary.

The package imports nothing but `zod` (enforced by dependency-cruiser), so it runs unchanged
in Node, browsers and React Native.

## Contents

| Folder           | What it defines                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/common/`    | Ids, codes (gender, platforms, report reasons), the error envelope and `AppErrorCode`, headers, pagination, shared entities (profile card, message) |
| `src/http/`      | Every REST endpoint: method, path, auth, idempotency, request, response, error codes. One file per owning module                                    |
| `src/socket/`    | Client → server events with acks, and server → client events                                                                                        |
| `src/events/`    | Domain events (`noun.verb.vN`) and their envelope `{ id, name, version, occurredAt, traceId, payload }`                                             |
| `src/jobs/`      | Job payloads and queue classes                                                                                                                      |
| `src/pipelines/` | Step input and output shapes for each pipeline                                                                                                      |
| `src/sections/`  | The profile-section registry format (empty in v1)                                                                                                   |
| `src/config/`    | `GET /v1/config` and feature-flag rules                                                                                                             |
| `src/env.js`     | The environment variable schema for every role                                                                                                      |
| `tooling/`       | OpenAPI and snapshot generation, and the contract diff (build-time only)                                                                            |
| `openapi.json`   | Generated OpenAPI 3.1 for the REST API. Do not edit by hand                                                                                         |
| `schemas.json`   | Generated JSON Schema snapshot of every contract, used by the contract diff                                                                         |

## Conventions

- **REST:** `/v1`, plural resources, cursor pagination `{ items, nextCursor }` (message history
  pages by `afterSeq` instead, because messages are addressed by seq). Every request sends
  `X-App-Version`. Every POST is idempotent: by `Idempotency-Key` header, by a client id in the
  body (`swipeId`, `targetId`), or by the resource id in the path. The OpenAPI operation
  carries `x-idempotency` with the mode.
- **Errors:** `{ error: { code, message, details?, requestId } }`. Each code has a fixed HTTP
  status (`ERROR_STATUS`). Socket acks use `{ ok: false, error }` with the same body.
- **Ids:** users are addressed only by their random `public_id`. Matches, conversations,
  uploads, photos (own) and reports use their UUIDv7. Admin-only resources (bans, reviews, audit
  entries) also use UUIDv7. See ADR 0007.
- **Messages** are identified by `(conversationId, seq)`; there is no separate message id. The
  `message.send` ack is `{ ok: true, clientMsgId, seq, createdAt }` or `{ ok: false, error }`.
- **Responses list every field.** Response, ack, server-event and domain-event objects are
  strict; a test fails if any emitted object would accept unknown keys. The only free-form
  records are documented in place (export data, error details, audit details).
- **Codes:** gender is `0` woman, `1` man, `2` non-binary; `interestedIn` is a non-empty set of
  these. New codes are additive.

## Auth flow notes

- `POST /v1/auth/otp` always answers `{ sent: true }` for an allowed domain, so it cannot be used
  to discover accounts.
- `POST /v1/auth/verify` takes an optional `signup` object. When the email has no account and
  `signup` is missing, it returns `SIGNUP_DETAILS_REQUIRED` only after a correct code. The code
  is **not** consumed and the attempt does **not** count as a failure: the client calls verify
  again with the same code plus `signup` until the code expires.
- The refresh token travels in the JSON body (mobile, `tokenTransport: "body"`) or in an
  httpOnly cookie named `vouch_refresh` (web, `tokenTransport: "cookie"`) with `Secure`,
  `SameSite=Strict` and `Path=/v1/auth/refresh`. The Phase 5 token ADR finalises it.

## Versioning rules

Contracts are **additive**. Never remove or narrow anything; ship a breaking change as a new
version beside the old one.

| Change                                                                                | Allowed? |
| ------------------------------------------------------------------------------------- | -------- |
| Add an optional request field, a response field, an endpoint, an event, an error code | ✅       |
| Add an enum value to a response (clients must ignore unknown values)                  | ✅       |
| Relax a request limit (longer max length, wider range)                                | ✅       |
| Remove or rename a field, endpoint, socket event, domain event, job or error code     | ❌       |
| Change a field's type, or remove an enum value or union option                        | ❌       |
| Add a required request field, or tighten a request limit, pattern or format           | ❌       |
| Make a required response field optional                                               | ❌       |
| Change an endpoint's method, path or success status, or tighten its auth              | ❌       |

Breaking changes ship as:

- **REST:** a new route (for example `/v2/...` or a new path) beside the old one.
- **Events:** `noun.verb.v2` published alongside `v1` until every consumer has moved.
- **Socket events:** `message.new.v2` beside `message.new`.

## Workflow

1. Change the zod schema here, and add or update its fixture in `test/fixtures/`.
2. Run `pnpm contracts:generate` to regenerate `openapi.json` and `schemas.json`, and commit
   them.
3. CI runs `pnpm contracts:check` (the generated files are current) and
   `pnpm contracts:diff --base origin/main` (no breaking change against `main`).

## Tests

- Every schema has a fixture with valid and invalid examples (`test/schemas.test.js`).
- Every emitted object is strict (`test/strictness.test.js`).
- `openapi.json` validates as OpenAPI 3.1 and matches the generator (`test/openapi.test.js`).
- The contract diff passes additive changes and fails each kind of breaking change
  (`test/diff.test.js`).
