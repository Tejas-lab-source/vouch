# @vouch/mobile

The Expo SDK 58 app (React Native 0.88, Expo Router). It uses the same Feature-Sliced layers
as web. The router files live in `src/routes` and only re-export pages.

- **Refresh token:** kept in `expo-secure-store` and sent in the body (body transport). The
  access token is kept in memory only.
- **Start-up:** the splash screen stays up until the session restore finishes.
- **Forced update:** a screen appears when the app is older than `minSupportedVersion`.

## Screens (Phase 12)

The same flows as web: onboarding, deck, match moment, matches and profile.

- **Photo picking:** from the library, with `expo-image-picker` (permission text in
  `app.config.js`).
- **Resizing:** to 2048 px with `expo-image-manipulator`.
- **Images:** `expo-image` caches in memory and on disk.
- **Swiping:** drag the card (`PanResponder`), use the buttons, or use the card's
  accessibility actions.

## Chat, push and settings (Phase 13)

- **Chat:** the Chats tab and `/chat/[id]` (an inverted `FlatList`). The last 50 messages per
  conversation are kept in AsyncStorage for offline reading and cleared at sign-out.
- **Push** (`expo-notifications`): permission is offered after a match, never at install.
  Tapping a notification opens the conversation, and opening it clears its notifications.
- **Settings:** `/settings` (from the Profile tab), with safety and privacy screens.

## Commands

- `pnpm dev` runs `expo start`. Set `VOUCH_API_URL` (read by `app.config.js`) to an API address the
  device can reach.
- `pnpm export:check` bundles for Android and iOS (Metro and Hermes). CI runs it.

There are no simulators in CI. The owner's manual device checks are listed in
`docs/phases/PHASE-11.md`.

## Builds (Phase 15)

- `app.config.js` (replaces `app.json`) picks the profile from `APP_VARIANT`, which `eas.json`
  sets: `development` (dev client, local API), `preview` (staging; Android internal testing
  and TestFlight; channel `staging`) and `production` (channel `production`).
- `VOUCH_API_URL` and `SENTRY_DSN` are EAS environment variables (public values, per EAS
  environment). `SENTRY_AUTH_TOKEN` is an EAS secret, used only to upload source maps.
- Store builds refuse a non-HTTPS API URL.
- The channels are set, but over-the-air updates also need the `expo-updates` package, which
  is not installed yet (it needs the owner's approval as a new dependency).
