## Phase 2 — Database architecture and migrations: Completion Report

**Summary:** The complete v1 database now exists as plain-SQL, reversible node-pg-migrate
migrations, one folder per module:

- 9 schemas, 27 tables, 6 read-only published views and 11 `NOLOGIN` roles
- `matching.swipes` and `chat.messages` hash-partitioned 16 ways
- a deterministic, idempotent seed with 2,000 synthetic users

The two approved tooling follow-ups also shipped: `tsc --checkJs` in CI, and fixture tests for
every boundary rule.

**Completion criteria:**

- [x] All migrations apply cleanly on Postgres 17 from zero — evidence: `test/db/migrations.test.js`
      (up → down to zero → up → no-op), plus `pnpm db:migrate` against Docker Compose and from
      inside the Docker image.
- [x] Every table in Task 5 and every view in Task 6 exists, with the listed constraints and
      indexes — evidence: the migrations test asserts the exact table and view lists;
      `constraints.test.js` and `partitions.test.js` cover the listed constraints, partitions
      and indexes.
- [x] Role permissions are verified by tests — evidence: `roles.test.js` checks an exact
      privilege matrix (11 roles × every table, partition and view), plus behavioural
      `SET ROLE` checks.
- [x] `docs/data-model.md` and the ADRs are written — ADRs 0003–0006.

**Conflicts with `docs/ARCHITECTURE.md` found and how they were resolved** (also listed in chat
before implementation):

1. **`identity.consents`:** missing from ARCHITECTURE 7.1. Built, because the roadmap Task 5
   and ARCHITECTURE 11.4 both require it.
2. **Module role privileges:** ARCHITECTURE 7.1 says "write only its own schema". Module roles
   also get narrow outbox, inbox, flags and deletion-task access (accepted decision 6), and read
   every published view (ARCHITECTURE 7.1).
3. **`profiles.profiles`:** `name` and `gender` are nullable, because Phase 6 creates an empty
   profile first; a CHECK requires them for `active`. `birth_date` is copied from identity
   (decision 4). `created_at` and `updated_at` were added.
4. **Deleted accounts:** ARCHITECTURE 7.5 says matches are _deleted_ on account deletion, while
   roadmap Phase 8 says _anonymise_ (accepted). `matches.anonymised_at` was added for the
   tombstone approach (decision 5).
5. **`chat.messages` has no `id`**, as in ARCHITECTURE 7.2; Phase 9's ack `id` must be defined
   in Phase 3.
6. **`chat.read_cursors.last_delivered_seq`** was added, for Phase 9's `markDelivered`.
7. **Retention columns:** `safety.reports.closed_at`, `context`, and `bans.lifted_at` and
   `expires_at` were added.
8. **Extra tables:** `admin.admin_users` and `platform.deletion_tasks` were added
   (decision 7).
9. **Interests:** no `interests` column. ARCHITECTURE treats interests as a profile _section_,
   but Phase 6's completeness rule names "interests". **Open for Phase 6.**
10. **`chat.conversations.user_low` and `user_high`:** added, so membership checks and per-user
    listings stay inside the chat schema.
11. **Discovery's role:** `vouch_discovery` reads views only, so its event consumption and
    `deck.served.v1` emission must run through `vouch_platform`. **Open for Phases 4 and 7.**
12. **ADR numbering:** repo ADRs are sequential (0003–0006 here); ARCHITECTURE 16.1 keeps its
    own list. The Phase 3 contract ADR becomes 0007.
13. **Unspecified tables:** nine tables were left at "v1 shape" without a definition. They were
    designed from the roadmap phases, and every column is listed in `docs/data-model.md`.

**What was built:**

- **Tooling:**
  - `tsconfig.json` (strict `checkJs`) and the `pnpm typecheck` CI step
  - `packages/config/test/boundaries/` (fixture tree plus test)
  - a `startTestPostgres()` helper in `packages/config/test/containers.js`
- **Migrations** (10 files, all with `-- Down Migration`):
  - `apps/api/migrations/platform/20261121000100_platform_roles.sql`, `…000200_platform_schema.sql`
  - `apps/api/src/modules/{identity,profiles,media,safety,matching,chat,notifications,admin}/migrations/*.sql`
- **Runner:** `apps/api/migrations/run.js`, with `migrate()` for tests and a CLI
  (`up | down [--count N] [--all]`). Migrations run in timestamp order in a single transaction
  under an advisory lock, recorded in `public.pgmigrations`.
- **Seed:** `apps/api/scripts/seed.js`, `scripts/lib/uuidv7.js`, `scripts/lib/prng.js`
- **Scripts:** `pnpm db:migrate`, `db:migrate:down`, `db:seed`; `DATABASE_URL` in
  `.env.example`
- **Docker image** now contains `migrations/` and can run them.
- **Docs:** `docs/data-model.md`; ADRs 0003 (schema and role per module), 0004 (UUIDv7 keys
  with a public id), 0005 (hash partitioning from the start), 0006 (no cross-schema foreign
  keys); `CHANGELOG.md`, `README.md`

**ER summary per schema:**

| Schema        | Tables (primary key)                                                                                                                          | Notable keys and indexes                                                                                                                                    | View               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| platform      | campus_clusters (id), colleges (id), outbox (id bigserial), inbox (consumer, event_id), feature_flags (key), deletion_tasks (user_id, module) | colleges → campus_clusters FK; GIN on email_domains; partial outbox index on unpublished rows                                                               | colleges_v         |
| identity      | users (id), devices (id), auth_sessions (id), consents (id)                                                                                   | unique public_id, email_hmac, token_hash; 18+ CHECK; FKs to users and devices; family_id index                                                              | active_users_v     |
| profiles      | profiles (user_id), photos (id), profile_sections (user_id, type)                                                                             | partial candidate index (cluster_id, gender, last_active_at DESC); FKs to profiles                                                                          | candidates_v       |
| media         | uploads (id)                                                                                                                                  | unique raw_key; type and size CHECKs                                                                                                                        | —                  |
| safety        | blocks (blocker_id, blocked_id), reports (id), bans (id), verification_reviews (id)                                                           | blocks(blocked_id); reports_queue (status, created_at); one active ban and one pending review per user                                                      | block_pairs_v      |
| matching      | swipes (swiper_id, target_id) ×16 hash partitions, matches (id)                                                                               | likes partial (target_id, created_at) WHERE direction = 1; passes partial (created_at) WHERE direction = 0; unique (user_low, user_high) + CHECK low < high | seen_v, likes_in_v |
| chat          | conversations (id), messages (conversation_id, seq) ×16 hash partitions, read_cursors (conversation_id, user_id)                              | unique match_id; unique (conversation_id, client_msg_id); messages(sender_id)                                                                               | —                  |
| notifications | prefs (user_id), deliveries (id)                                                                                                              | unique dedupe_key; quiet-hours CHECK                                                                                                                        | —                  |
| admin         | admin_users (id), audit_log (id)                                                                                                              | unique email_hmac; audit_log append-only (no UPDATE grant)                                                                                                  | —                  |

**Tests and validation:**

All of the following were run in a fresh clone (Node v24.22.3, pnpm 10.34.9, Postgres
17-alpine):

```
pnpm install --frozen-lockfile   → Done
pnpm lint                        → exit 0 (3 tasks, --max-warnings 0)
pnpm format:check                → All matched files use Prettier code style!
pnpm typecheck                   → exit 0
pnpm check:boundaries            → ✔ no dependency violations found (45 modules, 62 dependencies cruised)
pnpm test                        → 9 s total
  @vouch/config  Test Files 2 passed · Tests 4 passed
  @vouch/api     Test Files 8 passed · Tests 50 passed
```

Database tests (Testcontainers, Postgres 17):

```
migrations   ✓ every migration file declares a down section
             ✓ applies every migration up, in timestamp order, on an empty database
             ✓ reverts every migration down, leaving no schemas or roles behind
             ✓ applies every migration up again after a full revert
             ✓ is a no-op when everything is already applied
constraints  ✓ rejects a duplicate match pair            (23505 matches_pair_unique)
             ✓ rejects user_low >= user_high              (23514 matches_canonical_order)
             ✓ rejects a duplicate client_msg_id in one conversation (23505)
             ✓ allows the same client_msg_id in a different conversation
             ✓ accepts a user who turned 18 today / rejects one younger (users_adult_at_signup)
             ✓ rejects swipe direction ∉ {0,1} and self-swipes
             ✓ rejects an active profile without a name; allows one active ban per user
partitions   ✓ swipes and messages each have 16 partitions and rows land in every one
             ✓ a swiper_id lookup touches exactly one swipes partition
             ✓ a conversation_id lookup touches exactly one messages partition
roles        ✓ every role holds exactly the expected privileges on every table, partition and view
             ✓ roles cannot log in, are not superusers and cannot create objects
             ✓ matching cannot write chat.messages; can write its own tables and the outbox
             ✓ matching cannot read the outbox; admin cannot UPDATE audit_log
             ✓ discovery can read all 6 views; cannot read 5 sampled base tables
seed         ✓ builds identical data on every call; 2 colleges, 1 cluster, exactly 2,000 users, idempotent
             ✓ only eligible adult active candidates with ≥2 approved photos
             ✓ no plaintext email column; only *.example.edu domains
```

Partition pruning, run against the Compose database after inserting 5,000 random swipes (they
landed in all 16 partitions):

```
EXPLAIN SELECT * FROM matching.swipes WHERE swiper_id = '0195a3c2-…-000000000001';
 Seq Scan on swipes_p0 swipes  (cost=0.00..6.85 rows=1 width=42)
   Filter: (swiper_id = '0195a3c2-0000-7000-8000-000000000001'::uuid)

EXPLAIN SELECT * FROM chat.messages WHERE conversation_id = '…02' AND seq > 10 ORDER BY seq;
 Index Scan using messages_p6_pkey on messages_p6 messages  (cost=0.15..8.17 rows=1 width=160)
   Index Cond: ((conversation_id = '…02'::uuid) AND (seq > 10))
```

Migration output (`pnpm db:migrate`, Compose Postgres):

```
### MIGRATION 20261121000100_platform_roles (UP) ###
### MIGRATION 20261121000200_platform_schema (UP) ###
### MIGRATION 20261121001000_identity_schema (UP) ###
  … profiles, media, safety, matching, chat, notifications, admin …
up: 10 migration(s) ran
down: 10 migration(s) ran     (pnpm db:migrate:down --all)
up: 10 migration(s) ran
```

The image also runs the migrations itself
(`docker run … vouch-api node migrations/run.js up` → `up: 10 migration(s) ran`), with only
production dependencies (`fastify`, `node-pg-migrate`, `pg`, `postgres`, `zod`), as user `node`.

Seed timings (Compose Postgres 17, local):

| Run                    | Time   | Result                                                         |
| ---------------------- | ------ | -------------------------------------------------------------- |
| First (empty database) | 555 ms | clusters 1, colleges 2, users 2000, profiles 2000, photos 5928 |
| Second (idempotent)    | 383 ms | identical counts, nothing inserted                             |
| After down → up        | 538 ms | identical counts                                               |

**Tooling checks:**

- **Type check:** a deliberately mistyped file failed `tsc` (`TS2322`); the existing code had
  no type errors.
- **Boundary fixtures:** all 21 rules fire on their fixtures. When I temporarily disabled
  `domain-pure`, both tests failed; the config was then restored.

Coverage: not measured in this phase; the roadmap asks for none. Every SQL invariant listed in
Testing and validation has a test.

**Decisions made:**

- ADR 0003 — [Schema and role per module](../adr/0003-schema-and-role-per-module.md)
- ADR 0004 — [UUIDv7 keys with a public id](../adr/0004-uuidv7-keys-with-public-id.md)
- ADR 0005 — [Hash partitioning from the start](../adr/0005-hash-partitioning-from-the-start.md)
- ADR 0006 — [No cross-schema foreign keys](../adr/0006-no-cross-schema-foreign-keys.md)
- Owner decisions applied:
  - all 8 start-plan recommendations
  - `direction` 1 = like, 0 = pass
  - retention: report evidence 1 year after closure, bans while active, audit log 2 years,
    messages until deletion or unmatch + 30 days, passes 30 days
  - every retention row marked for legal review in Phase 14

**Deviations from the roadmap:**

- **Extra tables:** `admin.admin_users` and `platform.deletion_tasks` (decision 7).
- **Platform migrations location:** `apps/api/migrations/platform/`, because `src/platform`
  code belongs to Phase 4.
- **Seed helpers:** `scripts/lib/uuidv7.js` and `scripts/lib/prng.js` were added for the seed
  (decision 3).
- **Published views are read-only for their owning module too.** This hardening came out of
  the privilege-matrix test: default privileges had made simple, auto-updatable views
  writable.
- **`.prettierignore` excludes `docs/ARCHITECTURE.md`.** Prettier had rewritten it during
  `pnpm format`; I restored it exactly. Without this, `main`'s CI fails at the format check (it
  did for run 8 after the upload).
- **`zod@4.6.7` added to `apps/api`.** It is in the approved stack and validates CLI and env
  input for the runner and seed.

**Known issues and risks:**

- **Hosted Postgres must allow the migration user to `CREATE ROLE`.** Roles are cluster-wide,
  so a down migration in a cluster shared by several databases can fail to drop them. Confirm
  this in Phase 15.
- **Retention values marked _proposed_** in `docs/data-model.md` (revoked devices, consents,
  deletion tasks, disabled admins) need your confirmation, and all retention needs legal review
  in Phase 14.
- **Gender codes in the seed are placeholders** until Phase 3 defines them in contracts.
- **The Docker daemon in this cloud container stops between sessions.** I restart it as a
  tracked task. CI is unaffected.
- **Two open items for later phases:** interests as a column or a section (Phase 6), and
  discovery's event plumbing through `vouch_platform` (Phases 4 and 7).

**Suggested follow-ups (not done, need approval):**

1. Phase 3: define gender and interest code lists, and the message ack `id` shape.
2. Phase 4: decide whether `newId` reuses `scripts/lib/uuidv7.js` (move it into `src/platform`).
3. Phase 15: provision login users per environment and grant them the module roles.

**How you can check it yourself:**

```bash
git fetch origin claude/lucid-rubin-foq2uj && git checkout claude/lucid-rubin-foq2uj
```

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:boundaries && pnpm test
```

```bash
cp .env.example .env && docker compose up -d --wait && pnpm db:migrate && pnpm db:seed && pnpm db:seed
```

```bash
docker compose exec postgres psql -U vouch -d vouch -c "EXPLAIN SELECT * FROM matching.swipes WHERE swiper_id = gen_random_uuid()"
```

```bash
pnpm db:migrate:down --all && pnpm db:migrate
```

**CI run:** https://github.com/Tejas-lab-source/vouch/actions/runs/44956984924 (both jobs green on `04cab35`, the last code commit).

**Pull request:** opened from `claude/lucid-rubin-foq2uj` into `main`, titled "Phase 2 —
Database architecture and migrations" · Branch: `claude/lucid-rubin-foq2uj` (ADR 0002)

⏸️ I have stopped. Reply "Approved: Phase 2 complete" to close this phase.
I will not start Phase 3 until you approve its start plan.
