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
