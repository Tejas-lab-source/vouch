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

---

## Phase 14 — End-to-end testing, security, privacy and performance: Completion Report

**Summary:** Phase 14 delivers the owner's six tasks and the roadmap's testing, security,
privacy and performance scope:

- **Read receipts** are private by default: off unless switched on, and only when both people
  share them.
- **Audit:** every staff change is audited in the transaction that makes it.
- **Sessions:** admin sessions can be revoked at once, and sensitive user routes check the
  session.
- **The swipe** runs on the UI thread.
- **Load and chaos:** the 10x test on the beta plan found that the API crashed under
  overload; it now sheds load and stays up. The test also found that **the beta plan's
  Postgres (0.1 CPU) cannot carry even the beta peak**. That is the one decision needed from
  you; the measured recommendation is below.

**Completion criteria:**

- [x] **Coverage:** 85% on modules and 90% on the platform. Evidence: `vitest.config.js`
      thresholds, enforced in `pnpm test`. Measured lines: modules 94.8%, platform 97.4%.
- [x] **The new invariants, green 20 runs in a row:** no acked message lost across a gateway
      or worker kill; a block hides both users within one consumer cycle; deletion erases
      everywhere; each event processed once per consumer. Evidence: `pnpm test:invariants` ran 20 times in a row on `66b3d5f`, 11/11 every
      time: - load-smoke delivery p95 124–775 ms - lock-hold p95 14.1–18.4 ms - gateway failover gapless 20/20 - a block hidden everywhere in 178–257 ms (one cycle is under 3 s) - worker kill: 40/40 events processed once per consumer, every acked message stored,
      redelivery at most 30 s - deletion: no row left in any user-data table - socket memory: under 100 KB per idle socket
- [x] **k6 at 10x the beta peak** on Docker Compose with the beta plan's limits. Evidence:
      `docs/performance/phase-14-report.md`: p50/p95/p99 per route, error rate, event-loop
      lag, outbox lag, queue ages, Postgres and Redis CPU.
- [x] **Chaos:**
  - killing the API (API, gateway and worker: one process in the beta) and Redis, in the load
    kit (`CHAOS=1`)
  - killing the gateway and the worker alone, as invariants
- [x] **Performance fixes:** `EXPLAIN ANALYZE` of the top 10 queries (`load/explain.sh`).
      Each fix has a test that failed before it: overload shedding, the in-flight cap, heap
      sizing, pipeline timers.
- [x] **Security:**
  - `docs/security/threat-model.md`
  - `pnpm audit --prod` clean
  - a secrets scan over every commit (both now in CI)
  - headers, CORS, cookies, input limits, an authz test over every route, wrong-user ids,
    injection
  - JWT rotation, admin MFA and the IP allowlist (existing tests, listed in the threat model)
  - no SSRF surface (fixed provider hosts only)
- [x] **Privacy (DPDP):**
  - a versioned notice shown at sign-up, with consent recorded with its version
  - export and erasure completeness (tests)
  - retention jobs (8 nightly ticks: 7 modules and the platform)
  - no PII in logs (`logger.test.js`)
  - `docs/runbooks/{breach,incident,restore}.md`, with the 72-hour clock
  - the grievance contact published on `/privacy`; legal-review items flagged below
- [x] **Accessibility pass:**
  - web: strict WCAG 2.2 AA axe checks
  - mobile: an accessible-name check, which found and fixed `ListItem`
  - the device pass is in the owner's manual list
- [ ] **Beta SLOs met on the beta plan as specified.** Not met: Postgres at 0.1 CPU saturates
      at the beta peak. **Met on the recommended plan** (API 1 CPU, Postgres 0.5 CPU): - API p95 25–37 ms - deck p95 45 ms - message delivery p95 69 ms - push: no backlog, but not measured end to end (no real push provider in the test)

**Owner tasks:**

1. **Share read receipts** (ADR 0024, `50498ca`):
   - `GET`/`PUT /v1/me/chat-settings`: off by default and reciprocal, with a settings row on
     web and mobile
   - tests: neither, either one, or both sharing; turned off later; export; deletion
2. **Audit integrity** (ADR 0025, `39a75e4`):
   - Each module emits `audit.recorded.v1` in the transaction that makes the change, and
     admin stores it idempotently. Flags and sign-in write the row in their own transaction.
   - The failure-injection test rolls back a ban and a flag edit when their audit write fails.
3. **Admin sessions** (ADR 0026, `c092dbe`):
   - `POST /v1/admin/auth/logout`, and an `admin.sessions` row checked on every admin request
   - session checks on device management, deletion, export and self-unblock
4. **Gateway memory** (`edc5bf5`): 51–59 KB RSS per idle socket, against a target of under
   100 KB. The Phase 9 figure was RSS under load.
5. **Swipe** (ADR 0027, `c904cd6`): moved to Gesture Handler and Reanimated. The 60 fps check
   is in the owner's manual list.
6. **Before launch:** the list is below.

**What was built:**

- **Contracts (additive):**
  - `getChatSettings`, `putChatSettings` and `adminLogout` (53 endpoints)
  - the `audit.recorded.v1` event
  - env settings `PRESSURE_*`; `PRIVACY_NOTICE_VERSION` now defaults to `2026-11-draft`
- **API:**
  - chat settings, and chat member tombstones on deletion
  - the audit trail (`platform/uow.js`)
  - admin sessions, and the identity session guard
  - safety's export
  - overload protection (`platform/pressure.js`) and the in-flight cap
  - pipeline steps without timers
  - HTTP 64 KB body limit, socket 16 KB message limit, `perMessageDeflate` off
  - the consistency check covers every user-id column
- **Migrations:** `chat_member_settings`, `admin_sessions`, `platform_user_data_grants`. All
  expand-only, each with a down section.
- **Web:**
  - the read-receipts setting
  - the privacy notice: public `/privacy`, the sign-up dialog, Settings
  - the admin console signs out on the server and polls for audit entries
- **Mobile:** the read-receipts setting, the privacy notice, the swipe on the UI thread, and
  `ListItem` labels.
- **Tooling:**
  - the load kit `load/`: Compose with limits, k6, sampler, `EXPLAIN` script
  - `scripts/secrets-scan.js`
  - CI runs `pnpm check:secrets --history` and `pnpm audit --prod`
- **Docs:**
  - ADRs 0024–0027
  - `docs/security/threat-model.md` and `docs/performance/phase-14-report.md`
  - `docs/runbooks/` and `load/README.md`

**Tests and validation** (final run on `66b3d5f`, after every change):

| Check                                              | Result                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | pass                                                                                                       |
| `pnpm check:boundaries`, `pnpm contracts:check`    | pass (contracts: 53 endpoints, additive)                                                                   |
| `pnpm check:secrets --history`                     | no findings                                                                                                |
| `pnpm audit --prod`                                | no known vulnerabilities                                                                                   |
| `pnpm test`                                        | every package green; API 453 tests in 57 files; contracts 474; features-core 36; realtime 11; and the rest |
| API coverage (lines, enforced)                     | modules 94.7% (target 85%), platform 97.4% (target 90%)                                                    |
| `pnpm test:invariants`, 20 times in a row          | 20/20 green, 11/11 each                                                                                    |
| `pnpm --filter @vouch/web e2e`                     | 15 passed, including `a11y.spec.js` (strict WCAG 2.2 AA)                                                   |
| `expo export` (Android and iOS)                    | both Hermes bundles build                                                                                  |
| Load and chaos                                     | `docs/performance/phase-14-report.md`                                                                      |

**Load test (summary; full numbers in `docs/performance/phase-14-report.md`):**

| Run                                       | Served                          | Failed                         | Route p95    | Delivery p95 |
| ----------------------------------------- | ------------------------------- | ------------------------------ | ------------ | ------------ |
| 10x, beta plan, before the overload fix   | API crashed (heap) at 342 s     | —                              | —            | —            |
| 10x, beta plan                            | about 5 req/s; 6,000 sockets up | 98.9% shed (503 in under 1 ms) | 626–638 ms   | 41.7 s       |
| 1x, beta plan                             | 38.6 req/s                      | 37%                            | 2.7–7.9 s    | 4.5 s        |
| 1x, Postgres 0.5, API 0.5                 | 39.3 req/s                      | 0%                             | 0.3–1.3 s    | 146 ms       |
| **1x, Postgres 0.5, API 1 (recommended)** | **39.4 req/s**                  | **0%**                         | **26–45 ms** | **69 ms**    |
| 10x, no limits (API 4, Postgres 2)        | 388 req/s; 6,000 sockets        | 20.5% shed                     | 271–897 ms   | 632 ms       |

**Chaos (recommended plan, 1x):**

- **API killed:** `/ready` again 2.35 s after the restart started.
- **Redis killed for 10 s:** `/ready` again 1.5 s after Redis returned.
- **Over the whole run:** 3.3% of requests failed, all during the two faults. All 300
  messages were acknowledged, stored and delivered, and the outbox drained to 0.
- **Gateway kill (invariant):** 200/200 messages, gapless.
- **Worker kill (invariant):** 40/40 events processed once per consumer, and 60/60 acked
  messages stored.

**Security findings (all fixed, each with a test; `docs/security/threat-model.md`):**

1. An admin action could commit without its audit entry (fixed: ADR 0025).
2. Admin tokens could not be revoked, and there was no logout (fixed: ADR 0026).
3. A signed-out user's access token could still export or delete data for up to 15 minutes
   (fixed: ADR 0026).
4. HTTP bodies up to 1 MB were accepted (now 64 KB). Socket messages up to 1 MB were buffered
   (now 16 KB).
5. `pnpm audit --prod` reported 4 moderate advisories in `glob` and `minimatch` (transitive;
   now overridden, audit clean).
6. There was no secrets scan in CI (added; clean over all commits).
7. Under overload the API ran out of heap and dropped every user (fixed: shedding, in-flight
   cap, heap sizing).

**Privacy findings (fixed):**

1. Read receipts were always on (ADR 0024).
2. Consent was recorded against a version label, but the notice text was never shown (now a
   versioned notice, shown in full).
3. The export left out safety data: your blocks, the reports you filed, your verification
   status (added).
4. The consistency check missed 4 user-data tables, and a deleted user's id stayed in chat
   conversations (tombstoned; a schema test now keeps the list complete).

**Decisions made:**

- ADR 0024: read receipts are opt-in and reciprocal
- ADR 0025: audit in the same transaction
- ADR 0026: admin sessions and session checks
- ADR 0027: the mobile swipe on the UI thread

**Found while running the invariants 20 times:**

- **Two timing targets failed once each** under machine noise; correctness held every time.
  - Simultaneous-likes lock-hold p95: 20.8 ms against a limit of 20 (usually 14–17).
  - Chat load-smoke delivery p95: 1,071 ms against a limit of 1,000 (usually 340–780).
- **The target and every correctness assertion are unchanged.** Instead:
  - the swipe's block and pair checks now run concurrently under the lock
  - a chat send's independent lookups run concurrently
  - the likes invariant runs the REST role only. Since Phase 13, three modules consume
    `match.created`, and running them in the measured process skewed its timing. This is
    the isolation Phase 8 chose for the same reason.
- **The count restarted from zero** after each change.

**Decisions taken without the owner** (batch rules; also in PROGRESS):

- **Read receipts:** the setting is its own chat endpoint, not a field on the notification
  prefs as the plan said. Notifications depends on chat, and the reverse would create a
  module cycle.
- **The `feat(chat)!` marker** on `50498ca` is a mistake: the change is a behaviour change,
  not a contract break. History was not rewritten.
- **Audit:** multi-step actions write one entry per change, for example `ban.create` plus
  `report.ban`. A repeated ban lift is audited too.
- **Sensitive routes:**
  - devices, deletion, export, push-token registration, and safety's self-unblock
  - a repeated deletion needs no live session, because its sessions are already revoked
- **The privacy notice text** is a structured draft, marked "pending legal review" in the
  app.
- **The load test** runs `NODE_ENV=development`, because production refuses the console and
  dev providers.
- **Overload thresholds:**
  - 250 ms mean event-loop delay
  - 85% of the heap
  - 128 requests in flight
  - V8 gets 75% of the container
- **Two security fixes** found during the review: the input limits and the dependency
  overrides.
- **The secrets scan** is a small in-repo script. The network blocked the gitleaks image, and
  running an unvetted npx package over the history was refused in this environment.

**Deviations from the roadmap:**

- **The beta SLOs are met on the recommended plan, not the assumed one.** They need your
  decision.
- **Push p95 was not measured end to end.** There is no real provider in the load test.
  Measure it on the Phase 15 deploy.
- **The roadmap's "kill the gateway" and "kill the worker"** are invariant tests, because in
  the beta they are the same process as the API. The load kit's chaos kills that process.

**Known issues and risks:**

- **At 10x on large CPUs, the 10-connection pool is the ceiling.** It must be sized to the
  database plan's connection limit, which a 30-connection run exceeded. Growth beyond the
  beta means more processes or a pooler (performance report).
- **Chat `message.send` is not shed under overload**, unlike HTTP. Under 10x on the beta plan
  acks took 35–42 s. The new-socket refusal limits how much chat load arrives.
- **The worker-kill invariant** showed that chat opens a conversation in its own transaction
  before the consumer's inbox row. This is safe, because it is idempotent and redelivered,
  but the inbox row arrives late, after the queue's 30 s lock.
- **The mobile 60 fps check** and the device accessibility pass need a real device: the
  owner's manual checks.

**Suggested follow-ups (not done, need approval):**

- **Shed chat sends** under the same pressure signal (ack `TEMPORARILY_UNAVAILABLE`; clients
  already retry).
- **Outbox-lag and queue-age metrics with alerts** (ARCHITECTURE §12.6). The load test
  sampled them from outside.
- **Fold the per-transaction role preamble** into the query batch. That saves a round trip
  per read and raises what the pool can carry.
- **A pg_dump-to-R2 nightly job and the first restore drill** (Phase 15, `restore.md`).

**Before launch** (placeholders that must be real; owner task 6):

| Item                       | Where now                                                                                                                                                                                | What is needed                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Grievance officer contact  | `VITE_GRIEVANCE_EMAIL` (web), `GRIEVANCE_EMAIL` in `apps/mobile/src/shared/config` (`grievance@vouch.example`); `[Grievance officer name]` and `[grievance@vouch.example]` in the notice | A named person and a monitored address (DPDP)                                       |
| Privacy notice text        | `packages/i18n/src/privacy-notice.js`, version `2026-11-draft`, marked draft in the app                                                                                                  | Legal review. Then publish a final version and set `PRIVACY_NOTICE_VERSION` to it   |
| Company identity in notice | `[Company legal name and registered address]`                                                                                                                                            | The data fiduciary's legal name and address                                         |
| Terms of service           | **Not written**; nothing is shown or accepted                                                                                                                                            | Terms text, a version, and acceptance at sign-up (a new consent purpose)            |
| Support email              | `[support@vouch.example]` in the notice; none in the apps                                                                                                                                | A real address, also linked in Settings                                             |
| Brand                      | The working name "Vouch", Expo's default icon and splash, the web favicon and landing copy                                                                                               | The final name, icon, splash and store listing                                      |
| Mobile `apiUrl`            | `apps/mobile/app.json` `extra.apiUrl` = `http://localhost:3000`                                                                                                                          | The production API URL per build profile (EAS)                                      |
| Admin IP allowlist         | `ADMIN_IP_ALLOWLIST` empty                                                                                                                                                               | The office or VPN addresses (threat model)                                          |
| Turnstile site key         | `VITE_TURNSTILE_SITE_KEY` unset (dev captcha)                                                                                                                                            | A real key pair                                                                     |
| Providers                  | console email, log push, dev moderation and captcha in development                                                                                                                       | Resend, Expo, AWS Rekognition and Turnstile keys (production refuses dev providers) |

**Legal-review items flagged:**

- the privacy notice text and its effective date
- the breach notice template and the Board intimation channel (`breach.md`)
- retention periods: consent records kept, reports 1 year after close, logs 90 days
- processors outside India
- whether the college-email HMAC allows breach notification by email
- the age rule (18+)
- terms of service

**Owner manual checks:**

1. **Swipe at 60 fps (ADR 0027):**
   - Use a mid-range Android phone with a release build, and turn on the performance monitor.
   - Swipe 20 cards, including while a new deck page loads.
   - The UI thread holds 60 fps through each drag, fling and spring back.
2. **Read receipts:** on two devices, with both off (the default), you see Delivered, never
   Read. Turn it on for one person only: still no Read. Turn it on for both: Read appears.
3. **Privacy notice:** on sign-up, "Read the privacy notice" opens the full text. Then:
   - VoiceOver and TalkBack read the headings in order.
   - The consent switch announces its label.
4. **Device accessibility pass:** with VoiceOver and TalkBack, go through sign-in, the deck
   (Like and Pass actions on the card), matches, chat and Settings. Every control is
   announced with its name.
5. **Admin logout:** sign out in the admin console, then reuse the old token (for example
   from devtools). It now gets 401 at once.

**How you can check it yourself:**

```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test          # coverage thresholds enforced
pnpm test:invariants                                              # new invariants included
pnpm check:secrets --history && pnpm audit --prod
pnpm --filter @vouch/web e2e                                      # includes a11y.spec.js
docker build -t vouch-api:load . && load/run.sh 300 0.1           # beta peak; add 1 for 10x
LOAD_API_CPUS=1 LOAD_PG_CPUS=0.5 load/run.sh 300 0.1              # the recommended plan
CHAOS=1 LOAD_API_CPUS=1 LOAD_PG_CPUS=0.5 load/run.sh 300 0.1      # chaos
```

**Pull request:** https://github.com/Tejas-lab-source/vouch/pull/10 · Branch: `claude/lucid-rubin-foq2uj`

⏸️ I have stopped. Reply "Approved: Phase 14 complete" to close this phase. I will not start
Phase 15 until you reply "Approved: start Phase 15".
