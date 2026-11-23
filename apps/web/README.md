# @vouch/web

The web app: React 19, Vite 8, React Router and TanStack Query, in Feature-Sliced Design
(`src/app > pages > widgets > features > entities > shared`, enforced by dependency-cruiser).

## Run it

`pnpm dev` from the root runs the API and this app. Open http://localhost:5173. The dev
server proxies `/v1` and `/socket.io` to `VOUCH_API` (default `http://localhost:3000`), so the
refresh cookie works with no CORS. In development, the sign-in code appears in the API log
(the development email adapter).

## Commands

| Command      | What it does                                                                  |
| ------------ | ----------------------------------------------------------------------------- |
| `pnpm test`  | Component and app tests (Vitest, jsdom)                                       |
| `pnpm build` | Production build to `dist/`                                                   |
| `pnpm size`  | Fails if the initial JS is over 200 KB gzipped                                |
| `pnpm e2e`   | Playwright against the real API in Testcontainers, with axe in light and dark |

## Screens (Phase 12)

- **Onboarding** (`/onboarding`, resumable). The home shell waits until it is done.
- **Discover:** the deck, with Like and Pass buttons, ←/→ keys, and report or block on the card.
- **Match moment:** after a matching swipe or a `match.new` event.
- **Matches:** a "new" row, the list, the likes count, and unmatch with confirmation.
- **Profile:** fields, bio, photos and the slots.
- **Chat:** `/chats/:id` is a placeholder until Phase 13.

## Screens (Phase 13)

- **Chats:** `/chats` lists conversations with unread counts.
- **A conversation** (`/chats/:id`):
  - a virtualised history that opens at the newest message and loads older pages on demand
  - date separators
  - Sending/Sent/Delivered/Read on your own messages
  - the composer, with Enter to send
  - report or block in the header, and the ended state
- **Settings** (`/settings`): notifications and quiet hours, blocked people, the safety centre
  (`/settings/safety`), privacy (`/settings/privacy`), data export, log out, log out everywhere,
  and delete account.

Photos are resized in the browser to at most 2048 px and uploaded straight to storage (the
bucket's CORS rule allows `PUT` from the web origins).

Screens register into slots through `src/app/features.js`. The e2e suite (`e2e/match.spec.js`)
runs two browser users against the real API, with SeaweedFS for storage.
