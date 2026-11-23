# 0021 — Frontend architecture: shared packages, Feature-Sliced apps and the slot registry

- Status: Accepted (taken under the owner's batch authorisation for Phases 9–13; listed in the
  Phase 11 report under "Decisions taken without the owner")
- Phase: 11

## Context

Phase 11 starts three clients: web (React + Vite), mobile (Expo) and the staff console.
Phases 12 and 13 then add the product screens. The roadmap requires:

- Feature-Sliced Design
- a feature registry with named slots, so a new screen part does not edit existing screens
- one API client generated from the contracts
- no tokens in readable storage on the web

## Decision

- **One React.** React 19.3.0 everywhere, the version Expo SDK 58 pins, so the shared
  packages (`features-core`, `api-client`, `realtime`) run unchanged on web and mobile.
- **Shared packages:**
  - `i18n`, `domain` and `ui-tokens` are pure JS with no React
  - `api-client` and `realtime` hold no UI
  - `features-core` holds the React glue (providers, hooks and `<Slot>`), and the platform
    logic is tested there (the owner's note)
  - `ui-web` and `ui-native` are the two UI kits, with the same component names where they
    make sense (`Modal` on web is `Sheet` on native)
- **Generated client without zod at runtime.** `pnpm contracts:generate` also writes
  `packages/api-client/src/generated.js`: one plain fetch function per endpoint, carrying
  method, path, auth and idempotency metadata. Types come from JSDoc `import('zod')`
  inference, so the browser bundle gets types but no schema code. The contracts check fails
  if the file is stale.
- **Tokens:**
  - **Access token:** kept in memory only, on every client.
  - **Refresh token on the web:** carried in the existing httpOnly, `SameSite=Strict` cookie
    (`tokenTransport: 'cookie'`). The dev and preview servers proxy `/v1` and `/socket.io`
    under the same origin, so no CORS is needed.
  - **Refresh token on mobile:** kept in `expo-secure-store` (Keychain / Keystore) and sent
    in the body.
  - **Refresh:** single-flight, so concurrent 401s share one rotation. A refused refresh
    ends the session.
  - **Staff token:** held in memory only. Reloading the console means signing in again.
- **Idempotency keys:** a fresh key per attempt group. React Native has no
  `crypto.randomUUID`, so mobile injects `expo-crypto`'s.
- **Realtime:**
  - **Reconnect:** socket.io's own reconnect, plus a manual one with jittered backoff after
    a server-initiated disconnect, which socket.io does not retry. Every (re)connect sends
    `sync` with the stored cursors.
  - **Outbox:** keeps unacknowledged sends and retries them with the same `clientMsgId`.
  - **Token refresh:** `auth.refresh` runs 60 s before the token expires.
- **Feature registry:**
  - **Slots:** `home.tabs`, `profile.sections`, `profile.editor`, `chat.composerActions`,
    `chat.messageRenderers`, `deck.cardBadges` and `settings.rows`.
  - **Features:** `defineClientFeature` validates slot names and ids at start-up. A feature
    with a `flag` shows only while that flag is on in `GET /v1/config`.
- **Feature-Sliced Design:**
  - **Layers:** `app > pages > widgets > features > entities > shared` in every app.
    dependency-cruiser enforces it (no upward imports, no cross-slice imports in one layer,
    no imports between apps).
  - **Tests:** app tests live in `test/` (or `e2e/`), outside `src`.
  - **Mobile routes:** the Expo Router files live in `src/routes`, a thin layer that only
    re-exports pages. It counts as the `app` layer.
- **Styles:** the web kit's `styles.css` is generated from `ui-tokens` (CSS custom properties
  for light, dark and `prefers-color-scheme`) plus `components.css`. A test fails when the
  committed file is stale. Prettier ignores it because it is generated.
- **Pending review:** a `pr` (pending-review) token reaches only the routes the backend allows.
  The sign-in flow shows the "pending review" message for `ACCOUNT_PENDING_REVIEW` and goes no
  further. Phase 12 adds the ID-card screen.
- **Captcha:** a `captchaToken()` seam returns the development token. Turnstile is wired in
  Phase 15 with its site key, and production refuses the development verifier.
- **Extra dependencies** (not in the pre-approved list; each is standard and needed):
  - `@vitejs/plugin-react` 6.2.1: Vite's official React plugin (JSX, Fast Refresh)
  - `jsdom` 31.0.0: the DOM for Testing Library component tests
  - `@types/react` / `@types/react-dom` 19.3.0: so `tsc --checkJs` checks JSX
  - pnpm overrides pin `@expo/cli` 58.1.19 and `@expo/router-server` 58.0.21, so Expo's
    `expo-constants` peer resolves to one version

## Consequences

- Phases 12 and 13 add screens as client features that register into slots. The shells do not
  change.
- Web has no readable token anywhere. A reload restores the session silently through the
  cookie.
- Mobile is verified here by type-checking and `expo export` for Android and iOS. Device
  behaviour (secure store, push, splash) is on the owner's manual-check list.
- The web initial JS has a 200 KB gzipped budget, checked in CI
  (`pnpm --filter @vouch/web size`).
