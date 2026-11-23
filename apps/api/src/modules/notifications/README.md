# notifications

Push notifications for offline users (ADR 0019). Pushes never contain a message body, a name or
an internal id: a lock screen is public.

## Public API (`api.js`)

| Function                                         | Use                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `queue({ userId, template, params, dedupeKey })` | Queue a push from a registered template (preferences and quiet hours apply) |

No module calls it in v1. It is the extension point for later features.

## HTTP routes (contracts in `packages/contracts/src/http/notifications.js`)

| Route                           | Auth | Use case                                                   |
| ------------------------------- | ---- | ---------------------------------------------------------- |
| `PUT /v1/me/notification-prefs` | user | `putPrefs`: preferences, quiet hours and an IANA time zone |
| `GET /v1/me/notification-prefs` | user | `getPrefs`: the saved values, or the defaults              |

## Templates (manifest key `templates`)

| Template       | Preference        | Text                                            |
| -------------- | ----------------- | ----------------------------------------------- |
| `match.new`    | `pushMatches`     | "It's a match" / "Someone you liked likes you…" |
| `message.new`  | `pushMessages`    | "New message" / "You have a new message."       |
| `likes.digest` | `pushLikesDigest` | "N people liked your profile." (a count only)   |

## Events consumed

| Event                | What happens                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `match.created.v1`   | One push to the user who liked first                                                         |
| `message.created.v1` | A push if the recipient is still offline; one per conversation per 30 s (the rest `batched`) |
| `user.blocked.v1`    | A one-hour cancel marker: queued pushes between the pair become `cancelled`                  |
| `report.created.v1`  | An email to `ADMIN_ALERT_EMAIL` (ids, context and reason only)                               |
| `user.deleted.v1`    | Preferences and the delivery log are erased                                                  |

## Jobs

| Job                           | When                        | What                                                         |
| ----------------------------- | --------------------------- | ------------------------------------------------------------ |
| `notifications.sendPush`      | per push                    | Renders, sends to every signed-in device, records the ticket |
| `notifications.checkReceipts` | 15 min after a send         | `DeviceNotRegistered` → the token is removed (identity API)  |
| `notifications.likesDigest`   | daily 12:53 UTC (18:23 IST) | One digest per user with unanswered likes                    |
| `notifications.retentionTick` | nightly                     | Delivery rows older than 90 days                             |

## Adapters

| Port           | Production                                                    | Development                        |
| -------------- | ------------------------------------------------------------- | ---------------------------------- |
| `PushProvider` | Expo over `fetch`: chunks of 100, receipts in chunks of 1,000 | log: a token hash, never the token |
| `AlertEmail`   | Resend over `fetch`                                           | console                            |

## Tables owned (schema `notifications`)

`prefs` (a missing row means the defaults) and `deliveries`. Each delivery has a status
(`queued`, `sent`, `failed`, `suppressed` or `cancelled`) and a reason. It is keyed by a dedupe
key, so redelivered events are no-ops.
