# @vouch/features-core

Platform-neutral app logic shared by web and mobile, and the feature registry.

- **Registry:** `SLOTS` lists the named UI slots. `defineClientFeature` checks slot names and
  ids at start-up. `createFeatureRegistry().itemsFor(slot, flags)` returns a slot's items in
  order, without the items of features whose flag is off.
- **Auth:** `createAuthFlow` is the sign-in state machine: email, then code, then (first time)
  birth date and consent, then signed in. `errorKey` maps API errors to i18n keys.
- **React glue:**
  - `AppServicesProvider` / `useServices`
  - `useSession`, `useConfig` (`GET /v1/config`) and `useFlags`
  - `<Slot name>` and `useSlotItems`

- **Phase 12 hooks** (shared by web and mobile, tested against a mock API in
  `test/hooks.test.jsx`):
  - profile: `useMyProfile` and `useUpdateProfile`
  - photos:
    - `usePhotoUploads`, built on the `uploadPhoto` state machine (preparing → uploading
      with progress → confirming → processing → approved, rejected or pending; resumable)
    - `useDeletePhoto` and `useReorderPhotos` (optimistic, with rollback)
    - `fitWithin`, `MAX_EDGE` (2048) and `xhrPut`
  - deck and swipes:
    - `useDeck` (the next page when 3 cards remain; no duplicates; `exhausted`)
    - `useSwipe` (optimistic; a stable `swipeId` across retries; rollback)
  - matches: `useMatches` (infinite), `useUnmatch` and `useLikesCount`
  - safety: `useReport` and `useBlock`
  - onboarding: `useOnboarding` and `nextOnboardingStep` (resumes through the `Prefs` port)
  - analytics and events: `createLogAnalytics` with an allow-list (`docs/analytics.md`),
    `createEventHub` and `useRealtimeEvent`
- **Platform ports in `AppServices`:** `photoIo` (resize and upload), `prefs`, `analytics`,
  `events` and `newId`.

A new screen part is a new feature that registers into a slot. Existing screens are not edited.
Component tests run in jsdom.
