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
  `app.json`).
- **Resizing:** to 2048 px with `expo-image-manipulator`.
- **Images:** `expo-image` caches in memory and on disk.
- **Swiping:** drag the card (`PanResponder`), use the buttons, or use the card's
  accessibility actions.

## Commands

- `pnpm dev` runs `expo start`. Set `extra.apiUrl` in `app.json` to an API address the
  device can reach.
- `pnpm export:check` bundles for Android and iOS (Metro and Hermes). CI runs it.

There are no simulators in CI. The owner's manual device checks are listed in
`docs/phases/PHASE-11.md`.
