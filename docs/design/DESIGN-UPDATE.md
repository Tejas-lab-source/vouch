# Design update: Direction E — Modern Indian, trustworthy, fun

An owner-approved task outside the phase plan (Phase 15 stays paused). The spec is
`docs/design/design-system.md`; the three boards in this folder were visual references.
Screenshots: `docs/design/screenshots/before/` and `after/` (the same screens, light and dark,
taken by `pnpm --filter @vouch/web design:shots` on the real stack with synthetic data).

## What changed

**Tokens (`packages/ui-tokens`)** — the one place the brand lives:

- The spec palette in light and dark (dark is its own palette), plus derived tokens for
  pressed/disabled states, status badges (green, amber, red), subtle borders and the match
  celebration.
- Type: Poppins for headings (H1 30 Bold, H2 20 SemiBold), Inter for text (Body 15, Caption 12
  Medium); spacing 4–48; radii (cards 16, buttons 24, inputs 16, chips 20, modals 24); the
  three shadows (CSS and React Native); Lucide at 1.8 stroke.
- The "Vouch" wordmark with its heart, as SVG paths (outlined from Poppins Bold Italic, so it
  needs no font).
- Tests check the spec values and every text/background pair the components use against WCAG
  AA in both themes.

**Fonts and icons.** Self-hosted: `@fontsource/poppins` and `@fontsource/inter` on the web
(WOFF2, Latin, only the five weights used) and `@expo-google-fonts/*` bundled in the app.
There are no runtime calls to Google. Icons are `lucide-react` and `lucide-react-native`.

**Shared components.**

- `@vouch/ui-web` and `@vouch/ui-native` are restyled: buttons with pressed and disabled
  states, 16-radius inputs with a 1px border, six-box code input, cards and modals with the
  spec shadows, and toasts with a success or error icon.
- New components in both kits:
  - `StatusBadge` (verified, pending, rejected)
  - `Chip`
  - `IconButton` (round)
  - `Icon`
  - `Wordmark`
  - `Illustration` (web)
  - `Text` (native)
- The landing page is built from the same tokens.

**Web app.**

- **Layout:** the wordmark header has Settings and Sign-out icons. Navigation is a side rail
  with icons on desktop and a bottom bar on phones.
- **Sign-in:** the brand panel (motto and campus art) sits beside the form, and each step has
  an icon.
- **Deck:** the card shows the photo count, the college as a chip and a two-line bio, with round
  Pass and Like buttons.
- **Match moment:** a celebratory dark-red dialog shows both photos with a heart.
- **Chat:** red and white bubbles, a day pill, an amber "closed" banner and a round Send button.
- **Matches:** a pink likes banner, with rings around new matches.
- **Profile:** a header card with your photo, name, age and status.
- **Settings:** sections have icons.
- **Other screens:** onboarding has the wordmark and a progress bar, empty states show art,
  and the 404 page is restyled.

**Admin console.** Same tokens and fonts, kept dense:

- a sign-in card
- a header with the wordmark
- compact tables with a muted header row
- smaller buttons in rows

**Mobile app (screens 1–14).**

- **Welcome:** a new step with the wordmark, the motto, campus art and two buttons. "Get started"
  and "I already have an account" both open the same email form.
- **Sign-in steps:** each has an icon and a heading, and the code input is six boxes.
- **Onboarding:** a segmented progress bar, gender and "who to meet" as pill chips, and a
  two-column photo grid with status badges and icon controls.
- **Deck:** has a header with the wordmark and Settings, plus round Pass and Like buttons.
- **"It's a match!":** full-screen and celebratory.
- **Tab screens:** have title headers, and the tab bar has Lucide icons.
- **Chat:** an avatar header with Report and Block as icon buttons, and the restyled bubbles,
  closed banner and composer.
- **Profile and Settings:** a profile header, settings sections with icons, and red switches.

**No behaviour, API or contract changes.** The only non-visual additions:

- `packages/i18n` gains copy keys: `brand.motto`, `brand.audience`, the welcome buttons,
  `photos.reviewNote` and the nav label.
- The mobile secure-storage, prefs and push modules fall back to `sessionStorage` / no push
  when `Platform.OS === 'web'`. This is only so the Expo web build can run for screenshots;
  native builds are unchanged.
- The landing page's CSP allows `font-src 'self'` for its self-hosted fonts.

## Spec values adjusted for accessibility

Spec colours are kept wherever they pass. Where one fails **as text**, a text-only variant uses
the smallest lightness change that passes:

| Where                                     | Spec      | Used                  | Before → after                                                                         |
| ----------------------------------------- | --------- | --------------------- | -------------------------------------------------------------------------------------- |
| Red text, outlines, links (dark)          | `#D62828` | `#E26666`             | 3.28:1 on surface → 4.94:1                                                             |
| Error text (dark)                         | `#DC2626` | `#E66363`             | 3.40:1 on surface → 4.95:1                                                             |
| Error text on the "Rejected" pill (light) | `#DC2626` | `#CA2121`             | 4.1:1 → 4.58:1                                                                         |
| Success/verified text (light)             | `#16A34A` | `#11813B`             | 3.11:1 on background → 4.69:1                                                          |
| Secondary button pressed text (light)     | `#D62828` | `#BE2424`             | 3.75:1 on pink → 4.53:1                                                                |
| Input border ("subtle")                   | —         | `#8791A1` / `#696975` | 3:1, the minimum for a field's only edge (WCAG 1.4.11); cards and dividers stay subtle |

Filled buttons use the spec colours unchanged: white on `#D62828` is 5.01:1 and on `#DC2626`
4.83:1. Muted text is never placed on the pink secondary colour in light mode (3.62:1).

## Quality checks

Run locally on this branch. CI runs the same checks on push.

- **Contrast:** every text and button pair the components use is tested against WCAG AA in
  both themes (`packages/ui-tokens/test/tokens.test.js`).
- **Axe (serious and critical):**
  - Before: 16 of 34 screens had findings.
  - After: 4 of 46, every one on the screens captured from the Expo web build.
  - All web and admin pages are clean in both themes, and the e2e axe tests (UI kit, privacy
    notice, onboarding) pass.
  - The 4 left are one rule, `label-content-name-mismatch`, on the mobile Matches and Chats
    rows. It is an artifact of React Native Web, which renders the row's name and preview
    as separate text nodes with no space between them, so the visible text no longer
    matches the spoken label. On a phone, VoiceOver and TalkBack read the label. The
    mobile static accessibility test passes. Findings per screen: `screenshots/*/axe.json`.
- **Web initial JS:** 157.5 KB → 166.3 KB gzipped, against a 200 KB budget. The extra
  8.8 KB is the Lucide icons and the new components. Fonts are CSS and WOFF2, not JS.
- **Tests:** the full web e2e suite passes (15/15, real API). These pass too:
  - unit tests for ui-tokens, ui-web, ui-native, i18n, features-core, web, admin and mobile
  - the landing page tests in the API package, extended for tokens, fonts and the CSP
- **Static checks:** lint, typecheck (root, web, mobile), boundaries, secrets and contracts
  pass. They run in the commit hook.
- **Mobile:** `tsc` passes, and `expo export` passes for Android and iOS.
- **Screenshots:** phone-sized (390×844) screenshots of every mobile screen, light and dark,
  from the Expo web export.
- **Visual snapshots:** the repository has no pixel-snapshot tests. The before/after
  screenshot sets are the visual record, and `pnpm --filter @vouch/web design:shots`
  regenerates the "after" set.

**Dependencies added:**

- The approved list, at exact versions at least two weeks old:
  - `@fontsource/poppins` 5.3.0 and `@fontsource/inter` 5.3.0
  - `@expo-google-fonts/poppins` 0.4.1 and `@expo-google-fonts/inter` 0.4.2
  - `expo-font` 58.0.12
  - `lucide-react` 1.72.0 and `lucide-react-native` 1.72.0
  - `react-native-svg` 15.16.0, the version Expo SDK 58 pins
- **Needs your confirmation:** `react-native-web` 0.21.4 and `react-dom` 19.3.0, as mobile
  devDependencies. You did not list them, but "screenshots from the Expo web build" cannot
  be produced without them. They are only used by that build; the web product is still
  `apps/web`. If you would rather not keep them, removing both drops only the screenshot
  command.

**How the screenshots are made:** `apps/web/e2e-design/design.spec.js` runs on the e2e stack:

- Postgres, Redis and object storage in containers
- the seeded colleges
- generated photos, so no real people
- the mobile app exported for the web and served with the API proxied

The "before" set was taken from the commit before this work, from a separate worktree.

## Mockup elements deliberately not built

| Element                                                            | Why                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Continue with Google"                                             | Sign-in stays college email only (product rule)                                                                                                                                |
| "Online", "Typing…" in chats and headers                           | Product rule; there is no presence indicator to show                                                                                                                           |
| Verified tick next to every name                                   | Cards have no verification field. Every account is email-verified, but a tick would suggest ID verification. `StatusBadge status="verified"` is ready for when the data exists |
| Height, job, interests chips, "Future Data Scientist" taglines     | Not in our data                                                                                                                                                                |
| "98% profile complete", likes/matches/chats counters on My Profile | Not in our data (counts would be paged guesses)                                                                                                                                |
| Age-range slider and "Students from: Nearby colleges" dropdown     | The age range stays two number fields (same behaviour, accessible); there is no "nearby colleges" setting                                                                      |
| "Upload at least 4 photos"                                         | Photos stay 2–6                                                                                                                                                                |
| Read receipts toggle shown on                                      | Read receipts stay off by default                                                                                                                                              |
| Two-pane chat (list + conversation) on desktop                     | A layout change to routing and focus that the e2e flows rely on; left for a follow-up                                                                                          |
| "Discover more students nearby" panel on web                       | No such feature                                                                                                                                                                |
| Photo illustrations of people, the asset sheet                     | `docs/design/assets/` held an empty file. Clearly-marked placeholder SVGs are used (see below)                                                                                 |
| Report/Block as text links under a full profile                    | Kept as buttons (with icons): they must stay reachable on every profile and chat                                                                                               |

**Placeholders to replace:**

- `packages/ui-web/assets/campus-placeholder.svg` and `pattern-placeholder.svg` (web and
  landing)
- `apps/mobile/src/shared/ui/Illustration.jsx` (mobile)

Keep the file and component names; each says "placeholder" in its comment and in tiny text.

## Suggested future features (gaps the mockups show)

- Interests or prompts as chips on profiles (a profile section type)
- Optional height, course and graduation year on cards
- A verified badge on cards once ID/selfie verification is exposed in the card contract
- A profile-completeness hint
- An age-range slider on mobile
- A two-pane chat layout on desktop web
- Real campus illustrations, and per-college art
- Photo carousel dots on the deck card
