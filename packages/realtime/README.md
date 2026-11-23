# @vouch/realtime

A socket.io-client wrapper for the chat gateway (see `docs/adr/0017-chat-gateway-and-delivery.md`).

- `createRealtime({ url, session, cursors, onEvent })`:
  - connects with the access token and sends `auth.refresh` 60 s before it expires
  - reconnects with jittered backoff, including after a server-initiated disconnect
  - sends `sync` with the stored cursors on every (re)connect, so missed messages arrive once
  - `send()` queues a message and retries it with the same `clientMsgId` until acknowledged
    (the server stores it once)
- Delivery reports: each new highest seq per conversation is reported with `message.delivered`.
  `markRead(conversationId, seq)` sends `message.read` (no ack).
- `receipt.updated` (the other member's cursors) goes to `onEvent`. The cache adapter applies it
  to `keys.messages(id)`, and conversation-list refreshes during a burst are coalesced (at most
  one a second).
- `memoryCursors()` stores the last seen sequence number per conversation.
- `queryCacheAdapter(queryClient, keys)` updates the TanStack Query cache:
  - `message.new` appends to the conversation
  - `match.new` invalidates the matches
  - `config.changed` refetches the config

Tested against a real Socket.IO server.
