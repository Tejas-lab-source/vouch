# 0024 — Read receipts: opt-in and reciprocal

- Status: Accepted (owner instruction, Phase 14). Supersedes the read-receipt part of ADR 0023,
  where read receipts were always on.
- Phase: 14

## Context

Phase 13 showed the sender Sending → Sent → Delivered → Read, and read receipts were always
on. Telling someone when you read their message is personal information, and a dating app
should not reveal it by default. The owner asked for a "Share read receipts" setting, off by
default and reciprocal.

## Decision

- **The setting:** `GET`/`PUT /v1/me/chat-settings` `{ shareReadReceipts }`, owned by chat
  (table `chat.member_settings`). A missing row means off.
  - It is an additive contract change: two new endpoints, and documentation on `peerReadSeq`
    and `receipt.updated`.
  - It lives in chat, not in the notification preferences, because notifications depends on
    chat; the reverse would create a module cycle.
- **Reciprocal:** a read state passes between two people only when **both** share. Otherwise:
  - a read move sends nothing at all, not even the implied delivery
  - delivery moves send `receipt.updated` with the delivered cursor only, and `readSeq: 0`
  - `listMessages` returns `peerReadSeq: 0`, and the delivered cursor without the read
    implication
- **Takes effect at once:** turning it off stops read receipts immediately. Open conversations
  refetch, so earlier "Read" marks are replaced by the server's current answer.
- **Delivery states are unaffected.** Sending, Sent and Delivered still show; delivery reveals
  nothing about reading.
- **Export and erasure:** the export includes `shareReadReceipts`; account deletion removes the
  row.

## Consequences

- By default users see Delivered at most. Read appears only between two people who both opted
  in, which matches common messaging apps.
- Tests cover every combination: neither shares, only the sender, only the recipient, both,
  and both-then-off. They check the socket event and the REST view.
