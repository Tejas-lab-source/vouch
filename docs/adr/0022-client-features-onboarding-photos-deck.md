# 0022 — Client features: onboarding, photos, deck and matches

- Status: Accepted (taken under the owner's batch authorisation for Phases 9–13; listed in the
  Phase 12 report under "Decisions taken without the owner")
- Phase: 12

## Context

Phase 12 adds the first product screens on web and mobile: onboarding, profile and photos,
the deck, the match moment and the matches list. Two owner notes add backend work: a likes
count and photo reordering. Two more apply to the client: resizing to 2048 px before upload
and a CORS rule for browser uploads.

## Decision

- **Consent before data.** The API creates an account only with a birth date and consent
  (Phase 5), so the roadmap's order becomes: email → code → birth date and notice/consent →
  about you → who to meet → ages → photos → done. Under 18 is refused at the birth-date step,
  with the server's `UNDERAGE` answer shown as a clear message.
- **Onboarding position:**
  - It comes from the server profile (name, gender, interests, photos, `missing`), plus
    the steps the user confirmed on this device: the age range (it has server defaults) and
    the photos step.
  - Only step names are stored locally: web `localStorage`, mobile secure store. They are
    keyed by the pseudonymous public id, so closing the app resumes where the user stopped.
  - Onboarding can finish with 2 photos that are not rejected. The profile goes live when 2
    are approved, and the done screen says so.
- **Photos:**
  - **Pipeline:** the client resizes to at most 2048 px on the long edge and re-encodes as
    JPEG 0.9, which drops EXIF and location (web: canvas; mobile: `expo-image-manipulator`).
    It then presigns, PUTs with progress (`XMLHttpRequest`, on web and React Native), confirms
    and polls the profile for up to 60 s. A photo still under review shows as "In review".
  - **Retry:** after a failed PUT, retry presigns again. After a failed confirm, only the
    confirm is retried (idempotent on the upload id).
  - **Reorder:** `PUT /v1/me/photos/order` takes the full list of current photo ids. It must
    be the exact set, which a stale screen cannot silently drop. The new positions are written
    in one transaction, and the same order again is a no-op. The screens move a photo with
    "earlier"/"later" buttons rather than drag-and-drop, which keeps it keyboard and
    screen-reader operable with no new dependency.
- **Storage CORS:** the bucket allows only `PUT` with `content-type` from the web origins
  (`CORS_ORIGINS`). `pnpm storage:init` applies the rule locally; for R2 it is applied by
  hand, as documented in the media README.
- **Likes count:** `GET /v1/me/likes/count` returns `{ count }` only. Blocked users are
  excluded. Passes still buffered in Redis (seconds) may be counted until they are written.
- **Deck and swipes:**
  - **Cache:** the deck lives in TanStack Query as `{ cards, removed, exhausted }`. The next
    page is fetched when 3 cards remain. Cards already queued or recently swiped are never
    re-added, so a page fetched mid-swipe cannot bring a card back.
  - **Swipes:** a swipe removes the card at once and carries a `swipeId` made once per swipe.
    Network errors and 5xx are retried twice with the same id, then the card goes back where
    it was. `NOT_SERVED`, `BLOCKED`, `NOT_FOUND` and `PROFILE_INCOMPLETE` do not bring it
    back.
  - **Web:** Like/Pass buttons and ←/→ keys.
  - **Mobile:** drag (`PanResponder` + `Animated`, one JS driver for the whole gesture, as
    React Native requires), buttons, and accessibility actions. No gesture or animation
    library is added; 60 fps on a mid-range Android device is an owner check.
- **Match moment:**
  - It opens from a matching swipe or from `match.new`. The swiper receives both, so each
    match is shown and counted once.
  - "Send a message" goes to `/chats/:id` (web) or `/chat/[id]` (mobile), a placeholder
    until Phase 13.
- **Matches:**
  - **"New" row:** matches from the last 3 days. Without chat data there is no "no messages
    yet" signal; Phase 13 can refine this.
  - **List:** below the row, an infinite list; unmatch asks for confirmation.
- **Types:** the generated client's return types resolve to `any` across workspace packages
  (the contract helper's JSDoc does not carry the zod types through). `features-core` spells
  out the shapes the screens use (`OwnProfile`, `OwnPhoto`, `ProfileCard`, `MatchSummary`), so
  screens are type-checked.
- **Analytics:** a logging-only port with an allow-list of properties (`docs/analytics.md`).
- **Dependencies:** `expo-image` 58.0.18, `expo-image-picker` 58.0.10 and
  `expo-image-manipulator` 58.0.16 (Expo SDK 58 versions; pre-approved Expo packages). Nothing
  new on the web.

## Consequences

- Screens never call `fetch` directly. Every call goes through the generated client and the
  `features-core` hooks, which are tested against a mock API.
- Web end-to-end tests run against SeaweedFS with the real CORS rule, so a missing R2 rule
  would show up as the same failure in staging.
- Device-only behaviour (60 fps swipe, photo library permission, the secure store) is checked
  by the owner on Android and iOS.
