# 0017 — Socket gateway and exactly-once, in-order chat delivery

- Status: Accepted (taken under the owner's batch authorisation for Phases 9–13; listed in the
  Phase 9 report under "Decisions taken without the owner")
- Phase: 9

## Context

Chat must survive a gateway dying mid-conversation: a message the server acknowledged must
reach the other person exactly once and in order, even across a reconnect to another gateway.
Clients retry on a lost ack. Gateways are stateless and scale horizontally behind one Redis.
Workers and the API role also need to push events to sockets. A block or ban must never be
revealed to the person on the other side. Access tokens live 15 minutes, and sockets often
stay open longer than that.

## Decision

- **Gateway (`platform/ws.js`):** Socket.IO 4.8 with WebSocket transport only and
  `@socket.io/redis-adapter`. The access JWT (`vouch:user`) is checked at the handshake. Each
  socket joins `user:{id}`. Every client event is validated against `CLIENT_EVENTS` (and every server event against
  `SERVER_EVENTS`) from the contracts and acknowledged as `{ ok: true, … }` or
  `{ ok: false, error }`. Modules add handlers through the manifest `socket.handlers` key.
  Other roles emit through `@socket.io/redis-emitter` (`platform.sockets.emitToUser`), and a
  publish failure is logged and never thrown.
- **Token lifetime:** a socket is disconnected `SOCKET_REFRESH_GRACE_SECONDS` (default 60)
  after its token expires, with `auth.expired { reason: 'token_expired' }`, unless the client
  sends `auth.refresh { token }` first. A refresh token must belong to the same user. Both
  events are additive contract changes.
- **Conversation id = match id:** one conversation per match, opened idempotently by the
  `match.created.v1` consumer, so `listMatches` can return `conversationId` with no lookup.
- **Send:** checks run first: the rate limit (`RATE_LIMIT_MESSAGES_MINUTE`, default 60), then
  membership, then open, then the fail-closed `chat.messageFilters` pipeline (length, link
  limiter and block check; a block answers `CONVERSATION_CLOSED`, never `BLOCKED`). Then one
  transaction:
  - lock the conversation row (`SELECT … FOR UPDATE`) and re-check that it is open
  - if `(conversation_id, client_msg_id)` already exists, return the original message without
    using a seq
  - otherwise take `last_seq + 1 … RETURNING`, so seqs are gapless, and insert
  - if the recipient is offline, emit `message.created.v1` without the body
    The ack and the live `message.new` go to both members' rooms only after commit.
- **Recovery:** `sync { cursors: [{ conversationId, lastSeq }] }` replays up to 500 messages
  after each cursor, in seq order (`truncated` when more remain). Clients merge by
  `(conversationId, seq)`, which makes a live event and a replay of the same message
  idempotent.
- **Read and delivered cursors** only move forward (`GREATEST`) and are clamped to `last_seq`.
- **Closing:** unmatch, block, ban and deletion close the conversation, then send
  `conversation.closed` after commit:
  - the blocker gets `blocked`
  - after a block or ban, the other person gets `unmatched`, exactly as for an ordinary
    unmatch
  - the banned user gets `banned`
  - after a deletion, the other person gets `deleted`
    Messages are purged 30 days after close (`chat.retentionTick`, nightly), and at once on
    deletion.
- **Presence:** `chat:presence:{uid}` with a 60 s TTL, refreshed on each engine heartbeat. On
  disconnect, the key is cleared only if no socket of that user is left **on this gateway**
  (`local.fetchSockets`). Another gateway's sockets keep it alive through their own
  heartbeats. Only `isActiveRecently(userId)` leaves the module.
- **Drain on SIGTERM:** new connections are refused, and existing sockets are disconnected
  over `min(20 s, 0.8 × SHUTDOWN_DRAIN_MS − 1 s)`, so clients reconnect elsewhere gradually.

## Alternatives considered

- **Server-generated message ids with at-least-once delivery:** the client would have to
  de-duplicate by id. A seq per conversation gives ordering and gap detection for free.
- **A Redis stream per conversation:** a second source of truth beside Postgres.
- **Disconnecting at token expiry without refresh:** forces a reconnect every 15 minutes.
- **Separate `BLOCKED` acks:** would reveal the block.

## Consequences

- Measured (invariants):
  - **Gateway failover:** 200 messages; gateway A was SIGKILLed after 60 acks. All 200 were
    acked and stored once, gapless, and received once in seq order.
  - **Idempotent send:** 10 retries of one `clientMsgId` gave 1 row and `last_seq` 1.
  - **Load smoke:** 500 sockets on two gateway processes, 25,000 messages at about 490 a
    second: zero loss, zero duplicates, delivery p50 9 ms and p95 32 ms. Each gateway grew from
    about 157 MB to about 380 MB RSS with 250 sockets under load.
- Every message send takes a row lock on its conversation. Throughput per conversation is
  bounded, and that is acceptable for one-to-one chat.
- Live delivery is best effort. Correctness comes from `sync`, so clients must sync after every
  reconnect.
