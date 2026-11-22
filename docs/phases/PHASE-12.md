## Phase 12 — Frontend features I: onboarding, profile, discovery and matching: Start Plan

Written under the owner's batch authorisation for Phases 9–13 (see `docs/PROGRESS.md`,
"Batch run"); no separate approval is awaited.

**Status of prerequisites:**

- Phases 1–8 approved ✅
- Phases 9, 10 and 11 complete and pending owner review, with CI green ([PHASE-11](PHASE-11.md))

**What I will build:**

1. **Backend additions** (additive contract changes only, each with an integration test):
   - **`GET /v1/me/likes/count` → `{ count }`** (owner note). Matching's `likesIn` count of
     unanswered likes. It returns a number only, never who liked you.
   - **`PUT /v1/me/photos/order`** with `{ photoIds }` (owner note) returns `OwnProfile`.
     It must list exactly the caller's current photos. Positions are rewritten in one
     transaction, and an unknown or missing id is `VALIDATION_FAILED`.
   - **Storage CORS:**
     - Locally, `pnpm storage:init` applies a CORS rule to the SeaweedFS bucket: `PUT` from
       the web dev and preview origins, with only the signed headers.
     - The R2 rule (production origins only) is documented in the media README, for the owner
       to apply in Phase 15.
2. **`packages/features-core` hooks** (tested against a mock API):
   - **Profile:** `useMyProfile` and `useUpdateProfile`.
   - **Photos:**
     - `usePhotoUpload`: resize to at most 2048 px (a platform `prepareImage` port) →
       presign → `PUT` with progress → confirm → poll the profile until the photo leaves
       `pending`. A state machine with retry.
     - `useDeletePhoto` and `useReorderPhotos` (optimistic, rolled back on error).
   - **Deck and swipes:**
     - `useDeck`: fetches the next page when 3 cards remain, and drops duplicates.
     - `useSwipe`: removes the card optimistically, uses an idempotent `swipeId` (the same
       on retry), and puts the card back on error.
   - **Matches:** `useMatches` (an infinite query), `useUnmatch` and `useLikesCount`.
   - **Safety:** `useReport` and `useBlock`.
   - **Onboarding:** `useOnboarding`. The next step comes from the server profile
     (`missing`, photos) plus a local step marker. Only the step id is stored locally, never
     personal data, so progress survives a restart.
   - **Analytics:** an `Analytics` port, with a logging adapter in v1.
3. **Onboarding (web and mobile):**
   - **Order:** email → code → date of birth plus notice and consent (the API requires both
     to create the account, so consent comes before any data is stored; under 18 is blocked
     with a clear message) → name and gender → interested in → age range → photos → done.
   - **Photos:** at least 2, with per-photo status (pending, approved or rejected), delete,
     and reorder with accessible move buttons.
4. **Profile:**
   - view the own profile and edit its fields
   - manage photos, as in onboarding
   - the `profile.sections` and `profile.editor` slots (empty in v1)
5. **Discover:**
   - **Deck widget:**
     - Web: Like and Pass buttons, plus keyboard ←/→.
     - Mobile: swipe gestures (`PanResponder` and `Animated` with the native driver; no new
       dependency).
   - **Profile card:** a 400 px photo with details. The detail view uses 1080 px photos.
   - **Card extras:** the `deck.cardBadges` slot, and Report and Block actions on the card
     (Phase 10 APIs; a block removes the card).
   - **Empty deck:** "You're all caught up" with a time hint.
6. **Match moment:** on `{ matched: true }` or a `match.new` socket event, a match dialog
   offers "Send a message". It goes to the chat route, a placeholder until Phase 13.
7. **Matches:** a row of new matches (no conversation yet) and the list (infinite), the likes
   count, and unmatch with a confirmation step.
8. **Analytics:** onboarding steps completed, deck viewed, swipe and match, through the
   logging adapter. The event list goes in `docs/analytics.md`. Events carry no personal
   data.
9. **Images:**
   - **Web:** `<img loading="lazy">`, with explicit sizes and the browser cache.
   - **Mobile:** `expo-image` (memory and disk cache).
   - **Resizing:** canvas on the web, `expo-image-manipulator` on mobile. Images are
     re-encoded as JPEG at most 2048 px on the long edge, and the re-encode strips EXIF
     (including location).
10. **Real photo sizes** (owner note): measure the 400 and 1080 variant sizes on real
    photographs through the real pipeline, and record them in the report.

**Out of scope:** chat screens, notification permission prompts, settings and the safety
centre (Phase 13); admin panels (Phase 13).

**Dependencies** (Expo-recommended, pre-approved): `expo-image`, `expo-image-picker` and
`expo-image-manipulator` (SDK 58 versions). Nothing new on the web.

**How I will verify it:**

- **Hook tests (mock API):**
  - the optimistic swipe rollback, and the same `swipeId` on retry
  - the photo upload state machine (progress, confirm, poll, failure and retry)
  - the deck prefetch at 3 remaining
  - the onboarding step derivation and its restore after a restart
  - reorder rollback
- **Backend:** integration tests for the likes count and the reorder: ownership, an exact
  set, and the count never revealing identities.
- **Playwright (web), two browser contexts against the real stack** (Postgres, Redis and
  SeaweedFS in Testcontainers; development moderation):
  - both users onboard with 2 real JPEG photos, uploaded from the browser through CORS
  - each sees the other in the deck, both like, and both see the match
  - also covered: under-18 blocked, unmatch, and axe on each new page in light and dark
- **Mobile:** type-check and `expo export`, plus an owner manual checklist (60 fps swipes on
  a mid-range Android device, the photo picker, the camera roll permission).
- **Then:** every check, a clean clone, repeated runs, mutation checks and CI.

**Branch:** `claude/lucid-rubin-foq2uj` (ADR 0002); one PR for Phases 9–13 at the end.
