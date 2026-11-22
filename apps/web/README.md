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

Screens register into slots through `src/app/features.js`. Phases 12 and 13 add the product
features.
