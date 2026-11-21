# 0002 — Session branch and one pull request per phase

- Status: Accepted (by owner on 2026-11-21)
- Phase: 1

## Context

`docs/ROADMAP.md` A.6 asks for one branch per phase, named `phase/NN-short-name` and
created from `main`. Claude Code runs in cloud sessions that may push only to the
branch assigned to the session (for Phase 1, `claude/lucid-rubin-foq2uj`). Pushing
to a `phase/NN-*` branch is therefore not possible without extra permission.

## Decision

- Each phase is developed on the branch assigned to its Claude Code session, not on
  a `phase/NN-short-name` branch.
- At the end of each phase, Claude Code opens one pull request from that branch into
  `main`, titled `Phase N — <phase name>`, and links `docs/phases/PHASE-NN.md` in its
  description.
- **The phase's pull request replaces the `phase/NN` branch name** as the unit that
  identifies and reviews a phase.
- Claude Code never merges the pull request. The owner merges it when approving the
  phase.
- All other A.6 rules are unchanged: Conventional Commits, no force-push, no history
  rewrites, no branch deletion, and no secrets.

## Alternatives considered

- **`phase/NN-short-name` branches as written in the roadmap:** these are blocked by the
  session's push permissions, and asking for an exception every phase adds friction
  without improving review.
- **Pushing directly to `main`:** this removes the owner's review and merge step, and
  is forbidden by A.6.

## Consequences

- Branch names no longer show the phase. The pull request title and
  `docs/phases/PHASE-NN.md` do instead.
- If a later phase runs in a new session with a different assigned branch, that branch
  is used and its pull request still follows the title rule above.
- This deviates from `docs/ROADMAP.md` A.6. The owner may update the roadmap to match.
