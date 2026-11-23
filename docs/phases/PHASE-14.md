## Phase 14 — End-to-end testing, security, privacy and performance: Start Plan

Written under the owner's Phase 14 authorisation, with the same batch rules as Phases 9–13 (see
`docs/PROGRESS.md`, "Phase 14 run"); no separate approval is awaited. After this phase:
stop and wait for "Approved: start Phase 15".

**Status of prerequisites:** Phases 1–13 approved ✅. PR #9 was merged into `main` (ee8708a).

**What I will do, in this order:**

1. **Owner task 1 — "Share read receipts" (privacy fix, first):**
   - A per-user setting, off by default and reciprocal: `receipt.updated` and the peer read
     cursor reach a user only when both people share. Delivery states are unaffected.
   - Additive contract: a `shareReadReceipts` field on the notification prefs.
   - A settings row on web and mobile.
   - Tests that a read receipt is never sent, or exposed over REST, when either side has it
     off.
   - An ADR.
2. **Owner task 2 — audit integrity:** every admin action and its `audit_log` row are written
   in one transaction (or the outbox), so an action never happens without its entry. A test
   injects a failure between them and shows that neither is kept.
3. **Owner task 3 — sessions:**
   - **Admin logout and revocation:** `POST /v1/admin/auth/logout` and immediate revocation of
     admin sessions, checked on every admin request.
   - **Sensitive user routes:** check the session is still live (logout, device revoke, ban,
     deletion), so a revoked access token can no longer use them during its 15 minutes.
4. **Roadmap 6 — security review:**
   - `docs/security/threat-model.md`
   - an automated authorisation test that calls every route with no token, a user token, an
     admin token and another user's resource ids
   - headers, CORS, cookies, rate limits, input limits, presign constraints, JWT rotation,
     admin MFA and IP allowlist
   - SSRF/injection checks on outbound URLs
   - `pnpm audit --prod` and a secrets scan of the git history
   - every finding fixed with a test that failed before the fix
5. **Owner task 4 — gateway memory:** measure idle sockets separately from load-test overhead;
   find where the memory goes (Engine.IO buffers, per-message deflate, per-socket state); fix
   toward under 100 KB per idle socket, measured before and after.
6. **Roadmap 1–2 — test completeness and invariants:**
   - **Coverage:** map routes, socket events, consumers and use cases to tests, and fill gaps
     to 85%+ lines on modules and 90%+ on the platform.
   - **Invariants:** add the missing ones (no acked message lost across a worker kill, a block
     hides both users everywhere within one consumer cycle, deletion erases everywhere, each
     event processed once per consumer).
   - **Repeated runs:** the invariant suite green 20 runs in a row.
7. **Roadmap 3, 5 — load and performance:**
   - **k6** (`load/k6/*.js`, run with the `grafana/k6` image) against Docker Compose with the
     beta plan's resource limits (one `ROLE=all` process at 0.5 CPU / 512 MB, Postgres
     256 MB, Redis).
   - **Load model:** the 10x beta peak (470 req/s, 6,000 sockets, 125 swipes/s, 31 messages/s).
   - **Recorded:** p50/p95/p99 per route, error rate, event-loop lag, outbox lag, queue ages, and
     Postgres and Redis CPU.
   - **Performance fixes:** `EXPLAIN ANALYZE` the top 10 queries; fix indexes, N+1s and cache
     hit rates, each measured before and after.
   - **Report:** `docs/performance/phase-14-report.md`.
8. **Roadmap 4 — chaos:** kill the API, gateway, worker and Redis during load; verify recovery
   and no acked-data loss; document the results.
9. **Roadmap 7 — privacy and DPDP readiness:**
   - **Notice:** a versioned privacy notice text, shown at onboarding with consent recorded.
   - **Export and erasure:** completeness tests over every module.
   - **Retention:** the retention jobs verified.
   - **No PII in logs:** a log scan test.
   - **Runbooks:** `docs/runbooks/{breach,incident,restore}.md` (breach with the 72-hour
     clock).
   - **Grievance contact:** published.
   - **Legal review:** every item that needs a lawyer is flagged.
10. **Owner task 5 — swipe performance:** profile the mobile swipe (JS thread). Without a device
    here, the decision rests on the gesture design. The current JS-driven `PanResponder` path
    cannot guarantee 60 fps when the JS thread is busy (queries, sockets). So I expect to
    switch to `react-native-gesture-handler` + `react-native-reanimated` (UI thread), with an
    ADR. The 60 fps device check goes on the owner's list either way.
11. **Roadmap 8 — accessibility pass:** web (axe on every page, keyboard order, contrast) and
    mobile (labels, screen-reader order, dynamic type).
12. **Owner task 6 — "Before launch":** every placeholder that must be real before launch.
13. **Then:** every check, a clean clone, repeated runs, mutation checks and CI. The Completion
    Report, then the PR "Phase 14 — Testing, security, privacy and performance", then stop.

**Out of scope:** new features (other than the owner's read-receipt setting and admin logout),
and infrastructure provisioning (Phase 15).

**Dependencies:**

- the `grafana/k6` Docker image (the roadmap's load tool; not a package dependency)
- `react-native-gesture-handler` and `react-native-reanimated` (pre-approved by the owner;
  Expo SDK 58 versions)
- `@vitest/coverage-v8` is already present; nothing else new is expected

**How I will verify it:** each task above has its own test. Then the full suite, the
invariants 20 times in a row, the e2e suite, a clean clone, mutation checks, the k6 and chaos
runs recorded in the performance report, and CI.

**Branch:** `claude/lucid-rubin-foq2uj` (ADR 0002), fast-forwarded to `main` after PR #9.
