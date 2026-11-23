## Phase 13 — Frontend features II: chat, notifications, safety, settings and admin app: Start Plan

Written under the owner's batch authorisation for Phases 9–13 (see `docs/PROGRESS.md`,
"Batch run"); no separate approval is awaited.

**Status of prerequisites:**

- Phases 1–8 approved ✅
- Phases 9–12 complete and pending owner review, with CI green ([PHASE-12](PHASE-12.md))

**What I will build:**

1. **Backend additions** (additive contract changes only, each with an integration test):
   - **Read and delivery receipts for the sender:**
     - a new server event, `receipt.updated` `{ conversationId, deliveredSeq, readSeq }`, sent
       to the other member when a cursor moves forward
     - the other member's cursors (`peerDeliveredSeq`, `peerReadSeq`, optional fields) on the
       `listMessages` response

     These carry cursors only, never content.

   - **`GET /v1/me/notification-prefs`:** settings must show the current values (today the
     preferences are only writable).
   - **`GET /v1/me/blocks` and `DELETE /v1/blocks/{userId}`** (owner note): list the people you
     blocked and unblock one. Unblocking never restores a match or a conversation.
2. **`features-core` hooks** (tested against a mock API and a fake socket):
   - **Chat:**
     - `useConversations`
     - `useMessages(conversationId)`: an infinite query backwards, plus live appends from
       realtime, deduplicated by seq
     - `useSendMessage`: a message state machine, `sending` → `sent` (ack with seq) →
       `delivered` → `read`, with `failed` and retry keeping the same `clientMsgId`
     - `useMarkRead` and `useReceipts`
   - **Notifications:** `useNotificationPrefs` and `useUpdateNotificationPrefs`, plus a push
     port (permission, token, registration through `POST /v1/devices`).
   - **Settings and safety:** blocked users (list and unblock), data export, delete account,
     log out, and log out of all devices (revoke every other device, then log out).
3. **Chat UI (web and mobile):**
   - **Conversation list:** last message and unread count.
   - **Conversation screen:**
     - a virtualised list (web: `@tanstack/react-virtual`, the one pre-approved list
       library; mobile: `FlatList`)
     - date separators and per-message states
     - the composer with the `chat.composerActions` slot, and messages rendered through
       `chat.messageRenderers` by `kind`
     - the closed state, and report or block from the header
4. **Offline and resume (mobile):** the last 50 messages per conversation are kept on the
   device (`@react-native-async-storage/async-storage`, Expo-recommended) and cleared at sign
   out. Resume runs `sync`; queued sends go out after reconnect.
5. **Push (mobile):**
   - **Permission:** asked after the first match, not at install (`expo-notifications`).
   - **Registration:** the token goes through `POST /v1/devices`.
   - **Taps:** a tap deep-links to the conversation or the matches tab.
   - **Clearing:** opening a conversation clears its notifications.
   - Web push stays out of scope: it would need a service worker and VAPID keys, so it is a
     follow-up.
6. **Settings (web and mobile):**
   - notification preferences and quiet hours (with time zone)
   - the blocked-users list
   - a safety centre page (tips and how to report)
   - data export (download as JSON)
   - delete account, with confirmation and the 30-day cooling-off explanation
   - log out, and log out of all devices
   - the privacy notice and grievance contact
   - the `settings.rows` slot
7. **Admin app:**
   - **Panels:** rendered generically from the `GET /v1/admin/panels` definitions (list
     columns, detail fields and actions, with notes and confirmation where the definition
     says so).
   - **Panel list:** the reports queue with evidence and actions, photo review, verification
     reviews, user lookup and bans, the flags editor, the audit log, and overdue deletions.
   - **Every action** asks for confirmation and then shows the audit entry it created.
   - **Access:** routes are unreachable without an admin session.
8. **Phase 12 follow-up:** the "New" matches row becomes "matches with no messages yet", now
   that the conversation list is on screen.

**Out of scope:** typing indicators, media messages, premium, deployment, and web push (above).

**Dependencies** (pre-approved, exact versions at least two weeks old):

- `@tanstack/react-virtual` (web list virtualisation)
- `expo-notifications`, `expo-device` and `@react-native-async-storage/async-storage` (Expo SDK 58
  versions)

**How I will verify it:**

- **Hook tests:**
  - the message state machine, through every state and failure
  - dedupe on replay (live and `sync`)
  - a queued send after reconnect, with the same `clientMsgId`
  - receipts advancing the states
  - prefs round trip
- **Backend integration tests** for receipts (cursors only, members only), prefs `GET`, and
  blocks list and unblock (own blocks only; no match comes back).
- **Playwright (web, real stack):**
  - two users chat in real time
  - one goes offline (the browser context goes offline), gets the messages on return, in
    order and without duplicates
  - read receipts show
  - a block closes the chat for both
  - an admin signs in (password + TOTP), works the report and bans the user, and the banned
    user is signed out
  - axe on the chat, settings and admin pages
- **The message list with 1,000 messages:** only a window of rows is in the DOM, and scrolling
  stays responsive (a measured test).
- **Mobile:** type-check and `expo export`, plus an owner manual checklist (push in the
  background, tap opens the right conversation, the denied-permission path, offline resume).
- **Then:** every check, a clean clone, repeated runs, mutation checks and CI.

**Branch:** `claude/lucid-rubin-foq2uj` (ADR 0002); one PR for Phases 9–13 at the end.
