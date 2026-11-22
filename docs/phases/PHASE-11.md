## Phase 11 — Frontend foundation: Start Plan

Written under the owner's batch authorisation for Phases 9–13 (see `docs/PROGRESS.md`,
"Batch run"); no separate approval is awaited.

**Status of prerequisites:**

- Phases 1–8 approved ✅.
- Phases 9 and 10 are complete and pending owner review, with CI green
  ([PHASE-09](PHASE-09.md), [PHASE-10](PHASE-10.md); run 68).
- The roadmap asks for Phase 10 to be approved so the API is stable. Under the batch
  authorisation the backend contracts are frozen as of Phase 10; later changes will be
  additive only.

**What I will build:**

1. **Tooling:**
   - JSX (`.jsx`) in the root typecheck (`tsc --checkJs`, `jsx: react-jsx`) and in ESLint
   - Feature-Sliced Design boundary rules for every app in dependency-cruiser: `app > pages >
widgets > features > entities > shared`, with no imports between slices of one layer and
     no imports between apps
   - a jsdom Vitest preset for UI tests
2. **`packages/i18n`:** English strings and a `t(key, params)` helper (missing keys fail in
   tests). Apps contain no hard-coded user-facing strings.
3. **`packages/domain`:** shared pure rules: age from date of birth (the same rule as identity),
   email and OTP validators, and formatting (relative time, counts).
4. **`packages/ui-tokens`:** colour (a neutral accessible palette, light and dark), spacing,
   type scale, radii and motion, as JS objects and CSS custom properties. Contrast is
   checked by a test (WCAG AA). The name is "Vouch"; the brand is a placeholder.
5. **`packages/api-client`:**
   - plain fetch functions generated from `packages/contracts` (`pnpm contracts:generate` also
     writes `packages/api-client/src/generated.js`), carrying metadata only, so no zod reaches
     the bundle
   - base URL, `X-App-Version`, automatic `Idempotency-Key` for header-idempotent endpoints, and
     the error envelope mapped to `ApiError`
   - single-flight refresh rotation (concurrent 401s trigger one refresh)
   - cookie transport on web and body transport on mobile
   - TanStack Query key factories
6. **`packages/realtime`:**
   - a socket.io-client wrapper: connect with the token, `auth.refresh` before expiry,
     exponential reconnect, and `sync` with stored cursors on every (re)connect
   - an outgoing queue that retries with the same `clientMsgId`
   - a TanStack Query cache adapter: `message.new` appends, `match.new` invalidates matches,
     and `config.changed` refetches config
7. **`packages/features-core`:**
   - `SessionProvider` / `useSession` (state machine: signed out → code sent → signed in)
   - `useConfig` / `useFlags` (`GET /v1/config`)
   - the feature registry (`defineClientFeature`, `featuresForSlot`, flag-filtered) and a React
     `<Slot name>`

   Platform-neutral and tested here (the owner's note: shared logic is tested in
   features-core).

8. **`packages/ui-web`:** Button, Input, OtpInput, Avatar, Card, Modal (Sheet), Toast,
   EmptyState, Skeleton, ListItem and Badge. They are accessible (labels, visible focus,
   44 px targets, `prefers-reduced-motion`), with component tests in jsdom.
9. **`packages/ui-native`:** the same components for React Native (type-checked, and bundled
   by the Expo build).
10. **`apps/web`** (React + Vite + React Router):
    - FSD folders, providers (QueryClient, session, config/flags, realtime)
    - the registry with the slots `home.tabs`, `profile.sections`, `profile.editor`,
      `chat.composerActions`, `chat.messageRenderers`, `deck.cardBadges` and `settings.rows`
    - an error boundary and a 404
    - sign-in: email → code → (first time: birth date + consent) → the home shell with tabs.
      An expired session goes back to sign-in.
11. **`apps/mobile`** (Expo SDK 58 + Expo Router):
    - the same structure, registry and slots
    - tokens in `expo-secure-store`, body transport
    - the splash screen
    - a forced-update screen from `minSupportedVersion`
    - the same sign-in flow
12. **`apps/admin`** (React + Vite): sign-in with email, password and TOTP (the admin token
    is kept in memory only), and the panel renderer skeleton (it lists the panels from
    `GET /v1/admin/panels`; Phase 13 renders them).
13. **`apps/landing/index.html`:** a static placeholder.
14. **`pnpm dev`:** runs the API and web together. The web dev server proxies `/v1` and
    `/socket.io` to the API.

**Out of scope:** discovery, matching, chat, profile and settings screens (Phases 12–13);
admin panels; web push.

**Dependencies** (pre-approved unless noted; exact versions, each at least two weeks old):

- React and React DOM 19.3.0, the same version Expo SDK 58 pins, so web and mobile share one
  React
- Vite 8.3.6, React Router 8.5.1, TanStack Query 5.107.1
- Expo SDK 58 and its recommended packages (`expo-router`, `expo-secure-store`,
  `expo-splash-screen`, `expo-constants`, `react-native`, `react-native-safe-area-context`,
  `react-native-screens`)
- `@playwright/test` 1.63.0 (matches the preinstalled browser), `@axe-core/playwright`,
  Testing Library
- **Also needed, justified in ADR 0021:** `@vitejs/plugin-react` (Vite's official React
  plugin), `jsdom` (the DOM for Testing Library), `@types/react` and `@types/react-dom`
  (type-checking)

**How I will verify it:**

- Unit tests:
  - the api-client error mapping and refresh single-flight (concurrent 401s → one refresh)
  - realtime reconnect and `sync` against a real Socket.IO test server
  - slots filtered by flags
  - i18n coverage and token contrast
- Component tests for the web UI kit, in light and dark themes.
- One Playwright test on web against the real API (Testcontainers): sign in with the OTP from
  the development email adapter and land on the home shell, with an axe scan (no serious
  violations).
- The web initial-JS budget (under 200 KB gzipped), checked by a script in CI.
- The FSD boundary lint in all apps.
- Mobile: no simulators here, so the app must type-check and bundle (`expo export` for
  Android and iOS). The report carries an "Owner manual checks" list.
- Then every check, a clean clone, repeated runs, mutation checks and CI.

**Branch:** `claude/lucid-rubin-foq2uj` (ADR 0002); one PR for Phases 9–13 at the end.
