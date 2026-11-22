# Progress

Status values: `Not started`, `Plan sent`, `In progress`, `Report sent`, `Approved`.
See `docs/ROADMAP.md` Part A for the approval protocol.

| #   | Phase                                                                   | Status      | Start approved | Completed approved | Report             |
| --- | ----------------------------------------------------------------------- | ----------- | -------------- | ------------------ | ------------------ |
| 1   | Repository foundation and tooling                                       | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-01.md |
| 2   | Database architecture and migrations                                    | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-02.md |
| 3   | API, event and socket contracts                                         | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-03.md |
| 4   | Backend platform kernel                                                 | Approved    | 2026-11-21     | 2026-11-21         | phases/PHASE-04.md |
| 5   | Identity and authentication                                             | In progress | 2026-11-21     | —                  | —                  |
| 6   | Profiles, media and photo pipeline                                      | Not started | —              | —                  | —                  |
| 7   | Safety core and discovery engine                                        | Not started | —              | —                  | —                  |
| 8   | Matching                                                                | Not started | —              | —                  | —                  |
| 9   | Realtime chat                                                           | Not started | —              | —                  | —                  |
| 10  | Notifications, moderation and admin backend                             | Not started | —              | —                  | —                  |
| 11  | Frontend foundation                                                     | Not started | —              | —                  | —                  |
| 12  | Frontend features I (onboarding, profile, discovery, matching)          | Not started | —              | —                  | —                  |
| 13  | Frontend features II (chat, notifications, safety, settings, admin app) | Not started | —              | —                  | —                  |
| 14  | End-to-end testing, security, privacy and performance                   | Not started | —              | —                  | —                  |
| 15  | Deployment, observability and closed beta launch                        | Not started | —              | —                  | —                  |

## Notes for later phases

Owner instructions recorded here so the phase that owns them picks them up.

- **Phase 6 — photo object keys (owner, 2026-11-21):** photo object keys must not contain the
  internal user id. Use `photos/{publicId or random key}/{photoId}_{size}.webp`, so internal
  ids never appear in public CDN URLs. This replaces the `photos/{userId}/…` layout in roadmap
  Phase 6. The Phase 2 seed (`apps/api/scripts/seed.js`) still builds placeholder keys from the
  internal id and must be updated with it.
- **Phase 15 — deploy and runtime (owner, 2026-11-21, from the Phase 4 report):**
  - Start Node with `--import @opentelemetry/auto-instrumentations-node/register`, so ESM
    libraries are auto-instrumented.
  - Set the host's stop timeout to 30 s (the app drains for `SHUTDOWN_DRAIN_MS`, 25 s by
    default).
  - Trim the Docker image (483 MB after Phase 4, mostly OpenTelemetry and Sentry).
