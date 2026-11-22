# 0019 — Push notifications: Expo over HTTPS, batching and privacy

- Status: Accepted (taken under the owner's batch authorisation for Phases 9–13; listed in the
  Phase 10 report under "Decisions taken without the owner")
- Phase: 10

## Context

Offline users must hear about matches and messages, without a lock screen revealing who or
what. The owner asked for Expo push over plain HTTPS: chunks of 100, receipts checked, invalid
tokens removed, and no message bodies in payloads.

## Decision

- **Provider port** (`PushProvider`) with two adapters:
  - **Expo,** over `fetch`: 100 messages per send and 1,000 ids per receipts call, a 10 s
    timeout, and an optional `EXPO_ACCESS_TOKEN`.
  - **Log** (development): it records a token hash, never the token. Production refuses it.
- **Templates** come from a registry (manifest key `templates`): `match.new`, `message.new` and
  `likes.digest`. Text never contains a name or a message body. `data` holds only ids the
  client already knows (match and conversation ids), never internal user ids.
- **Triggers:**
  - `match.created.v1` sends one push, to the user who liked first.
  - `message.created.v1` (emitted only for an offline recipient) sends a push if the
    recipient is still offline. A Redis `SET NX EX` window allows one push per conversation per
    `PUSH_MESSAGE_BATCH_SECONDS` (30 s). Later messages in the window are logged `suppressed`
    with reason `batched`.
  - A daily `likes.digest` sends a count, never names.
- **Preferences and quiet hours** (`PUT /v1/me/notification-prefs`) suppress a push, logged as
  `preference` or `quiet_hours`. Quiet hours use the user's IANA time zone, and a window may
  wrap past midnight.
- **Blocks:** `user.blocked.v1` sets a one-hour cancel marker for the pair. A queued push from
  one to the other is then `cancelled`.
- **Delivery log** (`notifications.deliveries`): one row per attempt, keyed by a dedupe key
  (`match:{id}`, `message:{conversation}:{seq}`, `likes:{user}:{day}`), so a redelivered
  event is a no-op. Rows are written in the consumer's transaction, and kept 90 days.
- **Invalid tokens:** a `DeviceNotRegistered` ticket or receipt clears the token on the device
  through identity's API. Receipts are read 15 minutes later
  (`notifications.checkReceipts`).
- **Staff alert:** `report.created.v1` emails `ADMIN_ALERT_EMAIL` with the report id, context
  and reason only.

## Alternatives considered

- **Expo's SDK:** a dependency for two HTTP calls.
- **A delayed batch job per conversation:** adds a scheduled job for every first message.
  The fixed window is simpler and gives the same "at most one per 30 s".

## Consequences

- Measured: from a message sent to the push handed to the provider, p50 174–182 ms and p95
  194–195 ms locally (20 samples per run).
- A message in an open batching window produces no push of its own. The client shows the
  unread count when opened.
