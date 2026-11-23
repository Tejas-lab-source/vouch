# chat

One-to-one chat between matched users, delivered exactly once and in order through the socket
gateway (ADR 0017). The conversation id is the match id. Messages are text only in v1. Body
limits are 1–1,000 characters. New kinds plug into the `MESSAGE_KINDS` registry
(`domain/messages.js`).

## Public API (`api.js`)

| Function                   | Returns                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `isActiveRecently(userId)` | Whether the user had a live socket in the last minute (60 s) |

Presence details never leave the module.

## Socket events (contracts in `packages/contracts/src/socket`)

| Client event        | Use case                                                                          |
| ------------------- | --------------------------------------------------------------------------------- |
| `message.send`      | `send`; ack `{ ok: true, clientMsgId, seq, createdAt }` or `{ ok: false, error }` |
| `message.read`      | `markRead`: the read cursor moves forward only and is clamped to `last_seq`       |
| `message.delivered` | `markDelivered`: the same, for the delivered cursor                               |
| `sync`              | Up to 500 messages after each `{ conversationId, lastSeq }`, in seq order         |

When a read or delivered cursor moves forward, the other member gets `receipt.updated`
`{ conversationId, deliveredSeq, readSeq }` (cursors only, never content; Phase 13). A repeated or
older cursor sends nothing.

Server events: `message.new` (to both members, after commit), `match.new` (to both, when the
conversation opens), and `conversation.closed { conversationId, reason }`. The platform adds
`auth.refresh` and `auth.expired`.

## HTTP routes (contracts in `packages/contracts/src/http/chat.js`)

| Route                                 | Auth | Use case                                                                                                                                       |
| ------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/conversations`               | user | `listConversations`: by latest activity, cursor-paginated                                                                                      |
| `GET /v1/conversations/{id}/messages` | user | `listMessages`: history by seq (`afterSeq` forwards, `beforeSeq` backwards); the other member's `peerDeliveredSeq`/`peerReadSeq`; members only |

## Send rules

1. At most `RATE_LIMIT_MESSAGES_MINUTE` (default 60) messages per minute per user.
2. The conversation must exist (`NOT_FOUND`), the caller must be a member (`NOT_A_MEMBER`), and
   it must be open (`CONVERSATION_CLOSED`).
3. The `chat.messageFilters` pipeline runs and fails closed. Its steps:
   - `chat.length`
   - `chat.linkLimiter`: at most `CHAT_MAX_LINKS_PER_MESSAGE` links, and none before the
     sender's `CHAT_LINKS_AFTER_MESSAGES`th message (`MESSAGE_REJECTED`)
   - `chat.blockCheck`: a block answers `CONVERSATION_CLOSED`, never `BLOCKED`

   Other modules may contribute steps. Query steps time out after 500 ms.

4. One transaction under the conversation row lock:
   - re-check that the conversation is open
   - if the `clientMsgId` was already used, return the original message without using a seq
   - otherwise take the next gapless seq and insert
   - if the recipient is offline, emit `message.created.v1` (no body)
5. The ack and `message.new` go out after commit. A missed live event is recovered by `sync`.

## Closing

| Trigger              | Blocker / actor | The other person |
| -------------------- | --------------- | ---------------- |
| `match.unmatched.v1` | `unmatched`     | `unmatched`      |
| `user.blocked.v1`    | `blocked`       | `unmatched`      |
| Ban (Phase 10)       | `banned`        | `unmatched`      |
| `user.deleted.v1`    | —               | `deleted`        |

A block or ban is never revealed: the other person sees exactly what an unmatch shows.

## Report evidence (Phase 10)

Chat contributes the step `chat.reportEvidence` to safety's `safety.reportEvidence` pipeline.
For a chat report, it returns the last 20 messages, but only when the reporter and the target
are that conversation's two members (`NOT_A_MEMBER` otherwise). This is the only way staff
can read messages.

## Data and retention

- Tables `chat.conversations`, `chat.messages` (16 hash partitions) and `chat.read_cursors`
  (see `docs/data-model.md`).
- Messages are purged 30 days after their conversation closes (`chat.retentionTick`, nightly
  at 03:31), and at once when a member deletes their account.
- The export (`GET /v1/me/export`) contains the messages the user sent, never the other
  person's.
- Message bodies are never logged and never put in events or push payloads.
