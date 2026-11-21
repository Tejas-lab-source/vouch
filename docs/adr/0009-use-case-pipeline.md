# 0009 — The use-case pipeline

- Status: Accepted (by owner on 2026-11-21, Phase 4 start plan)
- Phase: 4

## Context

Every use case needs the same cross-cutting behaviour: tracing, metrics, authorisation, input
validation, feature-flag gates and idempotency. Repeating these in each handler (or each HTTP
route) drifts, and socket handlers and jobs would miss them.

## Decision

- `useCase(name, handler, opts)` (`platform/use-case.js`) wraps every handler in one fixed chain,
  outermost first: `withTracing` → `withMetrics` → `withAuthz` → `withValidation` → `withFlag` →
  `withIdempotency`.
  - **Tracing:** an OpenTelemetry span per call (a no-op until an exporter is configured).
  - **Metrics:** a `usecase_duration_seconds{usecase,outcome}` histogram.
  - **Authorisation:** `public`, `user` (user-audience token), `admin` (admin audience and MFA),
    or a predicate `(ctx, input) => boolean`. The default is `user`.
  - **Validation:** zod; failures become `VALIDATION_FAILED` with field paths.
  - **Flag:** the named flag must be on for the caller, otherwise `FEATURE_DISABLED`.
  - **Idempotency:** results are stored in Redis `platform:idem:{usecase}:{caller}:{key}` for
    24 h, together with a hash of the input.
    - A repeat with the same input returns the stored result.
    - A repeat with a different input gets `IDEMPOTENCY_KEY_REUSED`.
    - A repeat while the first call is still running gets `CONFLICT`.
    - A failure releases the key.
- The same wrapped use case serves HTTP routes, socket handlers and jobs: adapters stay thin
  (parse, call, map).
- A new cross-cutting layer is one more decorator added here once, never edits to modules.

## Alternatives considered

- **Fastify hooks only:** would not cover socket handlers, jobs or in-process API calls.
- **Per-module helpers:** the drift this ADR exists to prevent.

## Consequences

- Decorator order is fixed and tested. For example, an unauthorised caller never reaches
  validation, and an idempotent replay skips the handler but still records metrics and a span.
- The idempotency scope includes the caller, so two users can reuse the same key safely.
