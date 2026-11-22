# 0015 — Global rate limit per user, and trusted proxies for the client IP

- Status: Accepted (by owner on 2026-11-22, Phase 7 report and Phase 8 start plan)
- Phase: 8 (fixes Phase 4 code)

## Context

Phase 4's global limiter allowed 300 requests a minute per IP, and Fastify trusted every
`X-Forwarded-For`. Students on a campus usually share one public IP (ADR 0011), so the limit
would throttle a whole campus; and any client that reaches the app directly could forge
`X-Forwarded-For` to dodge per-IP limits (found during the Phase 7 benchmark).

## Decision

- **Limiter key:** the global limiter runs after authentication. Signed-in requests are limited
  per user (`RATE_LIMIT_USER_MINUTE`, default 300); every other request per client IP
  (`RATE_LIMIT_IP_MINUTE`, default 1,000), including requests whose token is missing or bad.
- **Hook order:** authentication is split. `authenticate` (`onRequest`, app level) sets
  `request.user` or records why it cannot, without rejecting; the limiter's route-level
  `onRequest` hook counts the request; `enforce` (`preValidation`) then rejects it. A flood of
  bad tokens is therefore throttled by IP, and an unauthenticated request still gets 401 before
  body validation.
- **Client IP:** `TRUSTED_PROXIES` (IPs and CIDRs, IPv4 and IPv6) lists the proxies whose
  forwarded address is believed; it is empty by default. For a request whose socket address is
  trusted, `CF-Connecting-IP` is used when it holds a valid IP, otherwise `X-Forwarded-For`,
  walked from the right across trusted hops only (Fastify `trustProxy` with the list). Any
  other request uses its socket address. `request.clientIp` holds the result, and every module
  uses it instead of `request.ip`.
- **Unchanged:** the Phase 5 OTP and verify limits.
- **Phase 15:** sets `TRUSTED_PROXIES` to Cloudflare's published ranges and Render's
  load-balancer addresses.

## Alternatives considered

- **Verifying the token inside the limiter's key function:** two signature checks per request.
- **Running the limiter after authentication only (`preHandler`):** requests rejected for a bad
  token would never be counted.
- **Trusting `X-Forwarded-For` everywhere and relying on the CDN:** unsafe if the origin is ever
  reachable directly.

## Consequences

- One signed-in user cannot exhaust a shared campus IP for everyone else.
- Locally (no trusted proxies) forwarded headers are ignored; tests that need distinct client
  IPs set `remoteAddress` or a trusted proxy.
