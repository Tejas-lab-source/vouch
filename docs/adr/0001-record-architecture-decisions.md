# 0001 — Record architecture decisions

- Status: Accepted (by owner on 2026-11-21, as part of the approved Phase 1 plan)
- Phase: 1

## Context

Vouch is built phase by phase by Claude Code, with the project owner reviewing every
phase. Decisions such as library choices, schema changes or deviations from
`docs/ROADMAP.md` must survive across sessions and be reviewable later. Chat history
and commit messages are not a reliable place for them.

## Decision

Record every significant architecture decision as an Architecture Decision Record (ADR)
in `docs/adr/NNNN-title.md`, using the template in `docs/ROADMAP.md` Part D.3.

- Numbers are sequential and never reused.
- An ADR starts as `Proposed` and becomes `Accepted` only when the owner approves it.
- Accepted ADRs are not edited; a later ADR supersedes them, and the old one's status
  becomes `Superseded by NNNN`.
- Per `docs/ROADMAP.md` A.7, an ADR overrides the roadmap only when the owner approved it.

## Alternatives considered

- **No formal record (commit messages and chat only):** decisions get lost between
  sessions, and there is no single place to review them.
- **Editing `docs/ARCHITECTURE.md` directly:** that shows the current design, but not
  why it was chosen or which alternatives were rejected.

## Consequences

- Every phase that makes a significant decision adds an ADR, and its completion report
  links it.
- Reviewers can trace any design choice to its reasoning and approval date.
