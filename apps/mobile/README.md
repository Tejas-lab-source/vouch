# @vouch/mobile

The Expo SDK 58 app (React Native 0.88, Expo Router). It uses the same Feature-Sliced layers
as web. The router files live in `src/routes` and only re-export pages.

- **Refresh token:** kept in `expo-secure-store` and sent in the body (body transport). The
  access token is kept in memory only.
- **Start-up:** the splash screen stays up until the session restore finishes.
- **Forced update:** a screen appears when the app is older than `minSupportedVersion`.

## Commands

- `pnpm dev` runs `expo start`. Set `extra.apiUrl` in `app.json` to an API address the
  device can reach.
- `pnpm export:check` bundles for Android and iOS (Metro and Hermes). CI runs it.

There are no simulators in CI. The owner's manual device checks are listed in
`docs/phases/PHASE-11.md`.
