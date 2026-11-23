# 0023 — Chat client, read receipts, push, settings and the admin console

- Status: Accepted (taken under the owner's batch authorisation for Phases 9–13; listed in the
  Phase 13 report under "Decisions taken without the owner")
- Phase: 13

## Context

Phase 13 completes v1 on the client: chat with delivery and read states, push on mobile,
settings and safety, and the staff console. The Phase 9 API stored read and delivered cursors
but never told the sender, and history paged only forwards.

## Decision

- **Receipts:**
  - The server sends `receipt.updated` `{ conversationId, deliveredSeq, readSeq }` to the other
    member when a cursor moves forward. It carries cursors only, never content, and goes to
    members only; an unchanged or older cursor sends nothing.
  - `listMessages` adds `peerDeliveredSeq`/`peerReadSeq`, plus `beforeSeq`/`prevBeforeSeq` for
    loading backwards from the newest message.
  - All of these are additive contract changes.
- **Message states:**
  - A message shows `sending` → `sent` (ack with seq) → `delivered` → `read`, derived from the
    peer cursors, or `failed` after a final refusal.
  - Retry and the realtime outbox reuse the `clientMsgId`, so a message is stored once.
  - Read receipts are sent only while the conversation is on screen (page visible / app in the
    foreground).
- **Delivery reports:** the realtime client sends `message.delivered` once per new highest seq
  per conversation.
- **The conversation list refreshes at most once a second during a burst.** Before this, 1,000
  messages meant 1,000 list requests, which hit the per-user rate limit.
- **Virtualisation:** web uses `@tanstack/react-virtual` (the pre-approved list library); mobile
  uses React Native's own `FlatList`.
- **Offline (mobile):**
  - The last 50 messages per conversation are kept in AsyncStorage and restored at start, marked
    "not loaded" so the newest page is still fetched.
  - They are cleared at sign-out and account deletion. Message text stays in the app's private
    storage.
- **Push (mobile, `expo-notifications`):**
  - **Permission:** offered after a match with an explanation first, never at install. A
    denial is respected, and settings explains how to turn pushes on.
  - **Taps:** a tap opens the conversation, using validated push `data`; opening a
    conversation clears its notifications.
  - **Web push:** not built. It needs a service worker, VAPID keys and a new dependency, so it
    is a follow-up.
- **Settings:**
  - **New endpoints:** `GET /v1/me/notification-prefs`, `GET /v1/me/blocks` (own blocks only,
    with a name) and `DELETE /v1/blocks/{userId}` (removes only the caller's block; ended
    matches stay ended).
  - **Log out everywhere** revokes the other devices, then this one.
  - **Account deletion** needs the word DELETE typed. The text says the account closes at once
    and the data is erased within 30 days, with no undo (the API has no restore).
- **Admin console:**
  - **Panels:** every panel renders from its manifest definition (columns by kind, detail,
    actions). A row's own id is its first `id`/`…Id` field, which the action paths take as
    `{id}`.
  - **Actions:** every action confirms, takes a note when the definition asks, then shows the
    audit entry it created. The list refreshes when the dialog closes.
  - **Custom views:** user lookup (with ban) and the flag toggle are the only panel-specific
    views.
  - **Access:** the token stays in memory only (ADR 0018).
- **Placeholders the owner provides later:** the grievance contact (`VITE_GRIEVANCE_EMAIL`,
  mobile `extra.grievanceEmail`) and the safety and privacy copy (legal review, Phase 15).

## Consequences

- Every v1 user flow is usable on web end to end against the real stack. Mobile shares the
  hooks and is verified by type-checking, bundling and the owner's device checklist.
- Read receipts are always on in v1. A per-user setting to hide them is a follow-up.
