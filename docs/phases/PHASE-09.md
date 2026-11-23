## Phase 9 — Realtime chat and WebSocket gateway: Start Plan

Written under the owner's batch authorisation for Phases 9–13 (see `docs/PROGRESS.md`,
"Batch run"); no separate approval is awaited.

**Status of prerequisites:** Phases 1–8 approved ✅ ([PHASE-07](PHASE-07.md),
[PHASE-08](PHASE-08.md)).

**What I will build:**

1. **Readable error messages first:** every `AppErrorCode` from Phases 3–8 gets a readable
   message, and a test fails if any code lacks one or just repeats the code.
2. **Socket server** (`apps/api/src/platform/ws.js`, roles `ws` and `all`): Socket.IO with
   `@socket.io/redis-adapter`, WebSocket transport only, origins from `CORS_ORIGINS`;
   handshake checked with the access JWT (`vouch:user`); join `user:{id}`; ping every 25 s;
   `auth.refresh { token }` (additive client event) extends the socket's expiry without a
   disconnect, and a socket with no valid refresh by expiry + 60 s is disconnected with
   `token_expired`; on SIGTERM stop accepting and spread disconnects over about 20 s within
   `SHUTDOWN_DRAIN_MS`; module handlers through the manifest `socket.handlers` key, validated
   against the socket contracts; workers emit through `@socket.io/redis-emitter`.
3. **`modules/chat`:** message-kinds registry (`text`; manifest key `messageKinds`), body limits
   (1–1,000), open or closed conversations; `openConversation(matchId)` (conversation id =
   match id, idempotent; consumer or first send); `send` (membership, open, block policy, the
   fail-closed `chat.messageFilters` pipeline with length, link limiter and block check; one
   transaction incrementing `last_seq … RETURNING` and inserting with `ON CONFLICT DO NOTHING`;
   a duplicate `clientMsgId` returns the original without using a seq; `message.created.v1`
   without the body when the recipient is offline; ack and `message.new` after commit; 60
   messages per minute per user, failing open); `markRead`, `markDelivered` (forward only);
   `history` (REST) and `sync` (socket); `closeConversation` (consumers of
   `match.unmatched.v1`, `user.blocked.v1`, `user.deleted.v1`; the blocker gets `blocked`, the
   other person `unmatched`, deletion `deleted`); nightly purge of messages 30 days after a
   conversation closes; presence (`chat:presence:{uid}`, 60 s, refreshed on pong) exposed only
   as `isActiveRecently`; export of the user's own sent messages.
4. **Gateway handlers:** `message.send`, `message.read`, `message.delivered`, `sync`,
   `auth.refresh`; server events `message.new`, `match.new`, `conversation.closed`.
5. **Routes:** `GET /v1/conversations`, `GET /v1/conversations/{id}/messages`.
6. **Matching:** `listMatches` fills `conversationId` (= match id).

**Out of scope:** push notifications (Phase 10), typing indicators, media messages.

**Dependencies (pre-approved):** `socket.io@4.8.4`, `@socket.io/redis-adapter@8.3.0`,
`@socket.io/redis-emitter@5.1.0`, `socket.io-client@4.8.4` (dev).

**Owner decisions applied:** the eight Phase 9 decisions recorded in `docs/PROGRESS.md`.

**How I will verify it:** unit tests; socket integration across two gateway processes and one
Redis; the three invariants (gateway failover with exactly-once in-order replay, idempotent
send, closed or blocked refused); a 500-socket load smoke (zero loss, delivery p95 under 1 s,
memory per 500 sockets); `auth.refresh` and `token_expired` paths; the block/ban
`conversation.closed` indistinguishable from an unmatch; end to end through `ROLE=ws` against
the Docker image; every check, clean clone, repeated runs, mutation checks and CI.

**Branch:** `claude/lucid-rubin-foq2uj` (ADR 0002); one PR for Phases 9–13 at the end.

---

## Phase 9 — Realtime chat and WebSocket gateway: Completion Report

**Summary:** Matched users now chat in real time through the `ws` role. Every message is
acknowledged only after commit. Each conversation has a gapless seq, a retry is never
duplicated, and `sync` replays missed messages in order after a reconnect, including across a
gateway that was killed mid-stream. Unmatch, block, ban and account deletion close the
conversation. A block or ban looks exactly like an unmatch to the other person. Every error
code now has a readable message.

**Completion criteria:**

- [x] **Two seeded matched users chat in real time through `ROLE=ws`, and replay works after a
      disconnect.**
  - Evidence: the Docker image `vouch-api:phase9`, run as three containers (`ROLE=api`, `ROLE=ws`
    and `ROLE=worker`); transcript below.
  - The `chat.integration` tests "delivers across gateways" and "sync replays after a
    disconnect".
- [x] **All three invariant tests pass:**
  - `chat-gateway-failover`
  - `chat-idempotent-send`
  - `chat-closed-refused` (3 cases)

  Output below; passed twice in a clean clone, and in CI.

- [x] **Load smoke:** 500 sockets and 50 messages each, with zero loss
      (`chat-load-smoke`).
- [x] **Owner decisions 1–8 and the error-message task:** each has a test; see below.

**Owner decisions, as implemented:**

| Decision                                                                  | Where and test                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Readable message for every `AppErrorCode`                                 | `platform/errors.js`; `error-messages.test.js` loops every code                                |
| 1. `auth.refresh`; `token_expired` after expiry + 60 s                    | `ws.js`; integration "refresh extends", "expiry disconnects", "refresh cannot switch users"    |
| 2. Disconnects spread over about 20 s within `SHUTDOWN_DRAIN_MS`          | `ws.js` `drain`; integration "drain spreads disconnects"                                       |
| 3. Redis emitter for worker roles                                         | `platform.sockets`; `match.new` is emitted from the consumer (worker) in the integration tests |
| 4. Conversation id = match id                                             | `openConversation`; `matching.integration` (`conversationId` equals `matchId`)                 |
| 5. At most 2 links, none in the first 3 messages, readable reason         | `chat.linkLimiter`; unit and integration "links"                                               |
| 6. 60 messages a minute per user, failing open                            | `send.js` `rateLimiter.hit`; integration "rate limit"                                          |
| 7. `blocked` / `unmatched` / `deleted`; `CONVERSATION_CLOSED` when closed | `domain/closing.js`; integration "block identical to an unmatch", "ban", "deletion"; invariant |
| 8. Ack after commit, best-effort live delivery, replay through `sync`     | `send.js`; the failover invariant                                                              |

**What was built:**

- **Platform:**
  - `platform/ws.js`: the gateway, `createSocketEmitter` and the drain
  - `platform/errors.js`: messages, and Fastify 4xx mapping
  - `platform/auth.js`: `expiresAt`
  - `platform/boot.js`: `platform.sockets`, with the gateway started for roles that have the
    socket capability
- **Contracts (additive):**
  - `auth.refresh` and `auth.expired`
  - four env vars
  - the `chat.retentionTick` job
  - an optional refusal `reason` on the message filters
- **`modules/chat/**`:**
  - domain: message kinds, link rule, closing notices
  - application: `openConversation`, `send`, `sync`, `markRead`, `markDelivered`, history,
    `listConversations`, `closeConversation`, the consumers, retention and export
  - adapters: Postgres stores, Redis presence, socket handlers, HTTP routes, the filter steps
  - its README
- **Other modules:**
  - `safety.api.blocks.blockersBetween`
  - `matching.listMatches` fills `conversationId`
- **Tests:**
  - 11 unit tests and 13 integration tests (`test/modules/chat/`, with a shared harness: an
    `all` runtime, two in-process gateways, and child-process gateways)
  - 4 invariant and load files in `test/invariants/`
- **Docs:**
  - ADR 0017
  - `docs/data-model.md` (sending rules)
  - the matching README
  - the CHANGELOG

**Invariant and load output** (clean clone, `pnpm test:invariants`, run 2):

```
PHASE9_FAILOVER {"messages":200,"acked":200,"storedRows":200,"receivedBySeq":200,"gapless":true,"clientIdsWithMoreThanOneSeq":0}
PHASE9_IDEMPOTENT {"attempts":10,"rows":1,"lastSeqAfterRetries":1}
PHASE9_LOAD {"sockets":500,"messages":25000,"acked":25000,"delivered":25000,"lost":0,"duplicates":0,
  "p50Ms":7,"p95Ms":22,"throughputPerSec":490,
  "gatewayRssMb":{"idle":{"a":163,"b":158},"with250SocketsEach":{"a":352,"b":350}}}
      Tests  7 passed (7)
```

- **Failover:** two `ROLE=ws` child processes. Gateway A is SIGKILLed after 60 acks. Both clients
  reconnect to B and the recipient syncs. Unacked sends are retried with the same `clientMsgId`.
- **Idempotent send:** 10 retries (the roadmap asks for 5).
- **Closed refused:** sends to an unmatched, a blocked and a non-member conversation are
  refused, and nothing is stored.
- **Delivery latency** (load smoke, cross-gateway: each pair's members are on different
  gateway processes):
  - Paced at about one message per second per socket (about 490 a second in total): p50 7–9 ms,
    p95 22–32 ms over four runs.
  - Unpaced burst (25,000 messages at once, measured while writing the test): p50 586 ms,
    p95 734 ms, with zero loss. That figure is mostly queueing, which is why the committed
    test is paced.
- **Memory:** a gateway process idles at about 160 MB RSS, and holds about 350–380 MB with 250
  sockets under load. That is roughly 400–450 MB above idle for 500 sockets over two
  gateways, or about 0.8 MB per socket under load, including in-flight buffers.

**Tests and validation** (clean clone of `9d5e6b7`; Node 24, pnpm 10.34.9; every check unpiped
or with `set -o pipefail`):

```
pnpm install --frozen-lockfile    → ok
pnpm lint                         → 0 (max-warnings 0)
pnpm typecheck                    → 0
pnpm format:check                 → 0
pnpm check:boundaries             → ✔ no dependency violations found (350 modules, 856 dependencies cruised)
pnpm contracts:check / :diff      → 0 / 0 (additive only)
pnpm test                         → contracts 385 passed, config 4 passed, api 362 passed
  api coverage: statements 95.48 %, branches 86.88 %, functions 96.59 %, lines 96.96 %
pnpm test:invariants (twice)      → 7 passed, 7 passed; no unhandled errors
```

CI: see the running log in `docs/PROGRESS.md` (the run on this report's commit).

**Mutation checks** (each change made by hand, the tests run, and the change reverted):

| Mutation                                                      | Result                                 |
| ------------------------------------------------------------- | -------------------------------------- |
| Duplicate `clientMsgId` not checked                           | idempotent-send invariant fails        |
| Closed check under the row lock removed                       | unit test fails (close lands mid-send) |
| `chat.blockCheck` filter step answers "not blocked"           | 1 unit + 2 closed-refused cases fail   |
| Membership check removed                                      | closed-refused (non-member) fails      |
| `sync` ignores membership                                     | 1 integration test fails               |
| Read cursor not clamped to `last_seq`                         | 1 integration test fails               |
| Read cursor may move backwards                                | 1 integration test fails               |
| `message.created.v1` emitted although the recipient is online | 1 integration test fails               |
| `auth.refresh` may switch users                               | 1 integration test fails               |
| Token expiry never enforced                                   | 1 integration test fails               |
| Fastify 415 maps to 500 (the old behaviour)                   | 1 errors test fails                    |

Two survivors from the first round were fixed:

- **A duplicate block check in `send`:** it sat beside the filter step and was removed. Blocks
  are now judged once, by the fail-closed `chat.blockCheck` step.
- **The closed check under the lock had no test of its own:** a unit test now covers a close
  that commits between the pre-check and the lock.

**End to end against the Docker image** (`vouch-api:phase9`, 544 MB; `ROLE=api` on 3000,
`ROLE=ws` on 3001, `ROLE=worker`; Compose Postgres, Redis and SeaweedFS; 2,000-user seed):

```
1) A likes B                               → {"matched":false,"matchId":null}
2) B likes A                               → {"matched":true,"matchId":"01a201fd-…"}
   both sockets  <= match.new {"matchId":"01a201fd-…","conversationId":"01a201fd-…","user":{…}}
3) A sends "hi there"                      → {"ok":true,"clientMsgId":"0488887f-…","seq":1,…}
   A and B      <= message.new seq 1
4) B sends twice with one clientMsgId      → seq 2, then the same seq 2 (stored once)
5) B disconnects; A sends two more         → seq 3, seq 4 (only A's own room gets message.new)
6) B reconnects; sync from lastSeq 2       → 3:are you there? | 4:coffee tomorrow?  truncated false
7) 3 links in A's first messages           → {"ok":false,"error":{"code":"MESSAGE_REJECTED","message":"A message can contain at most 2 links.",…}}
8) Invalid payload                         → VALIDATION_FAILED with field paths
9) GET /v1/conversations as B              → lastMessage, lastReadSeq, closed:false
   C (not a member) reads A–B messages     → NOT_A_MEMBER
10) C blocks D                             → 200; D sends → CONVERSATION_CLOSED
    C <= conversation.closed {"reason":"blocked"}   D <= {"reason":"unmatched"}
11) A unmatches (POST /v1/matches/{id}/unmatch) → 200; B sends → CONVERSATION_CLOSED
    A and B <= conversation.closed {"reason":"unmatched"}
Error-level logs in the three containers: 0. Message bodies in any log: 0.
docker stop --time 30 → exit 0 for api, ws and worker.
```

During this check, a request with the header `content-type: undefined` (a mistake in my test
client) came back as 500. Fastify's own 415 fell through the error mapper. That is fixed (a
415 now gives `UNSUPPORTED_MEDIA_TYPE`, and any other Fastify 4xx gives `VALIDATION_FAILED`)
and tested.

**Decisions made:**

- [ADR 0017 — Socket gateway and exactly-once, in-order chat delivery](../adr/0017-chat-gateway-and-delivery.md)

**Decisions taken without the owner** (under the batch authorisation; all in ADR 0017 unless
noted):

1. **Seqs under a conversation row lock.** `SELECT … FOR UPDATE`, then a duplicate lookup, then
   `last_seq + 1` and the insert. The roadmap's `ON CONFLICT DO NOTHING` insert is replaced by
   a lookup under the lock, with the unique constraint as the backstop. Either way, a repeated
   `clientMsgId` never uses a seq.
2. **The additive server event `auth.expired { reason: 'token_expired' }`** is sent before the
   disconnect, so clients can tell expiry from a network drop.
3. **An optional `reason` on a `chat.messageFilters` refusal** (additive), which carries the
   readable `MESSAGE_REJECTED` text.
4. **`safety.api.blocks.blockersBetween`** (additive), so the closing notices know who blocked
   whom.
5. **Emitter publish errors are logged, never thrown.** Live delivery is best effort, and
   correctness comes from `sync`.
6. **Presence is cleared on disconnect only when no socket of that user is left on this
   gateway.** Other gateways keep it alive through their heartbeats, and there is no
   cross-gateway query at shutdown.
7. **Drain window:** `min(20 s, 0.8 × SHUTDOWN_DRAIN_MS − 1 s)`, so the drain always finishes
   inside the configured shutdown window.
8. **Fastify client errors map to stable codes** (`UNSUPPORTED_MEDIA_TYPE`,
   `VALIDATION_FAILED`) instead of 500 (no ADR; a bug fix).
9. **The load smoke is paced** at about one message per second per socket, so it measures
   delivery latency rather than a backlog. The unpaced burst figure is reported above.
10. **`sync` returns at most 500 messages per call,** with `truncated: true` when more remain.

**Deviations from the roadmap:**

- **Drain:** spread over about 20 s within `SHUTDOWN_DRAIN_MS` (owner decision 2), not over
  30 s.
- **The ack shape** is `{ ok: true, clientMsgId, seq, createdAt }`, as the owner decided in
  Phase 3, not `{ id, seq, createdAt }`. Messages have no separate id.
- **Block check:** done by the fail-closed `chat.blockCheck` filter step (through
  `safety.blockPolicy`), not by a separate call before the pipeline. The roadmap lists both,
  but they were redundant (found by the mutation check).
- **Insert:** see decision 1.
- **Idempotent-send invariant:** 10 retries instead of 5.
- **Ban closing:** bans arrive in Phase 10. The ban notice is built and tested now, with a
  `safety.bans` row and a forced unmatch, as a ban will produce.

**Known issues and risks:**

- **Memory:** about 0.8 MB per socket under load (RSS, including buffers). At the launch
  target that is fine on one Render instance, but it should be re-measured on Render in
  Phase 15.
- **Throughput per conversation** is bounded by the row lock. That is fine for one-to-one chat,
  and is noted in ADR 0017.
- **Sync after every reconnect is required.** Live delivery is best effort. The clients in
  Phases 11–13 must sync after every reconnect; this is noted for them in `docs/PROGRESS.md`.
- **The load smoke** runs the client and two gateway processes on one machine. It is not a
  capacity test.

**Suggested follow-ups (not done, need approval):**

- Typing indicators, and media messages (out of scope by the roadmap).
- A per-conversation message-count metric for the admin dashboard.

**How you can check it yourself:**

```bash
cp .env.example .env && pnpm dev:keys --write && docker compose up -d --wait && pnpm db:migrate && pnpm db:seed
```

```bash
pnpm test && pnpm --filter @vouch/api test:invariants
```

To run the roles separately: `ROLE=api PORT=3000`, `ROLE=ws PORT=3001 METRICS_PORT=9465` and
`ROLE=worker PORT=3002 METRICS_PORT=9466`. Then connect a Socket.IO client to
`http://localhost:3001` with `transports: ['websocket']` and `auth: { token }`.

**Pull request:** one PR for Phases 9–13 at the end of the batch · Branch:
`claude/lucid-rubin-foq2uj`

Phase 9 is marked "Complete — pending owner review"; under the batch authorisation I continue
with Phase 10.
