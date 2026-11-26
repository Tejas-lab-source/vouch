# Vouch design system

**Direction E — Modern Indian, trustworthy, fun.** This file is the source of truth for the
visual design. The boards in this folder (`vouch-ui-showcase.png.png`,
`vouch-design-board.png.png`, `vouch-design-system.png.png`) are visual references only; where
they disagree with this file (they show several palettes and type sizes), this file wins.

Every value below lives in code in one place, `packages/ui-tokens/src/index.js`, which feeds
the web CSS variables (`@vouch/ui-web/styles.css`), the native theme (`@vouch/ui-native`
`useTheme()`) and the landing page. To change the brand, change the tokens.

## Colours

| Role       | Light     | Dark      |
| ---------- | --------- | --------- |
| Primary    | `#D62828` | `#D62828` |
| Secondary  | `#F8D7DA` | `#3B1F1F` |
| Background | `#FFF7F0` | `#0B0B0F` |
| Surface    | `#FFFFFF` | `#1F1F24` |
| Text       | `#1F2937` | `#FFFFFF` |
| Muted text | `#6B7280` | `#9CA3AF` |
| Success    | `#16A34A` | `#16A34A` |
| Error      | `#DC2626` | `#DC2626` |

Dark mode uses this palette; it is not an inverted light mode.

### Accessibility adjustments (WCAG 2.2 AA)

The spec colours are kept for fills, icons and large shapes. A few spec colours are below 4.5:1
when used **as text** on some backgrounds, so the tokens add text-only variants, each the
smallest lightness change that passes. The original colour is still used everywhere it passes.

| Token (theme)            | Spec      | Used                  | Why                                                                                                                          |
| ------------------------ | --------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `primaryText` (dark)     | `#D62828` | `#E26666`             | Red text/outline on `#0B0B0F` is 3.92:1, on `#1F1F24` 3.28:1 (needs 4.5). Now 5.92 / 4.94 / 4.51 on pink                     |
| `dangerText` (dark)      | `#DC2626` | `#E66363`             | Error text on `#0B0B0F` is 4.07:1, on `#1F1F24` 3.40:1. Now 5.92 / 4.95                                                      |
| `dangerText` (light)     | `#DC2626` | `#CA2121`             | Error text on the pale red "Rejected" badge (`#FEE2E2`) is 4.1:1. Now 4.58 or more everywhere                                |
| `successText` (light)    | `#16A34A` | `#11813B`             | Green text on `#FFF7F0` is 3.11:1, on the pale green badge less. Now 4.52 or more                                            |
| `primaryPressed` (light) | —         | `#BE2424`             | The spec's "darker red pressed". Chosen so red text on the pink pressed background passes (4.53)                             |
| `border` (both)          | "subtle"  | `#8791A1` / `#696975` | Input outlines are the only edge of a field, so they need 3:1 (WCAG 1.4.11). Cards and dividers keep a subtle `borderSubtle` |

White text on Primary (5.01:1) and on Error (4.83:1) passes in both themes, so filled buttons
use the spec colours as they are. Muted text is never placed on the pink Secondary colour in
light mode (3.62:1).

### Supporting colours (derived, not in the spec)

| Token                         | Light                 | Dark                  | Use                            |
| ----------------------------- | --------------------- | --------------------- | ------------------------------ |
| `successSoft`                 | `#DCFCE7`             | `#0F2A1A`             | Verified badge background      |
| `warningSoft` / `warningText` | `#FEF3C7` / `#92400E` | `#3A2A0A` / `#FBBF24` | "Pending review" badge (amber) |
| `dangerSoft`                  | `#FEE2E2`             | `#3B1F1F`             | "Rejected" badge background    |
| `surfaceMuted`                | `#F6EDE6`             | `#2A2A30`             | Skeletons, photo placeholders  |
| `borderSubtle`                | `#EEDFD6`             | `#2E2E35`             | Card and list dividers         |
| `primaryDisabled`             | `#EBA9A9`             | `#5A2525`             | Muted red (disabled primary)   |

## Typography

| Style   | Font    | Size | Weight       | Line height |
| ------- | ------- | ---- | ------------ | ----------- |
| H1      | Poppins | 30   | Bold 700     | 38          |
| H2      | Poppins | 20   | SemiBold 600 | 28          |
| Body    | Inter   | 15   | Regular 400  | 22          |
| Caption | Inter   | 12   | Medium 500   | 16          |
| Label\* | Inter   | 15   | SemiBold 600 | 20          |

\* Label (buttons, list titles) is derived from Body; it is not in the spec.

Fonts are self-hosted: `@fontsource/poppins` and `@fontsource/inter` (web, WOFF2, only the
weights above, Latin subset) and `@expo-google-fonts/poppins` / `@expo-google-fonts/inter`
(mobile, bundled TTFs). No runtime request goes to Google.

## Spacing

`4, 8, 12, 16, 24, 32, 40, 48` (tokens `space[1]` … `space[8]`).

## Radius

| Element | Radius    |
| ------- | --------- |
| Cards   | 16        |
| Buttons | 24 (pill) |
| Inputs  | 16        |
| Chips   | 20        |
| Modals  | 24        |
| Avatars | round     |

## Shadows

| Element | Shadow                         |
| ------- | ------------------------------ |
| Cards   | `0 6px 16px rgba(0,0,0,0.10)`  |
| Buttons | `0 2px 8px rgba(0,0,0,0.08)`   |
| Modals  | `0 12px 32px rgba(0,0,0,0.16)` |
| Inputs  | none; a 1px border             |

## Buttons

| Variant   | Normal      | Pressed         | Disabled  |
| --------- | ----------- | --------------- | --------- |
| Primary   | red filled  | darker red      | muted red |
| Secondary | red outline | pink background | faded     |
| Ghost     | transparent | light pink      | muted     |
| Danger    | red filled  | dark red        | muted     |

All buttons are at least 44 px tall and show a visible focus ring.

## Components

- **Verified badge:** green tick (ShieldCheck / check) on pale green.
- **Pending review:** amber badge. **Rejected:** red badge.
- **Interest chips:** pale pink (Secondary), rounded (20).
- **Chat bubbles:** outgoing red with white text; incoming white (dark surface in dark mode).
- **Toasts:** rounded, with a success or error icon.
- **Bottom navigation:** Discover, Matches, Chats, Profile.

## Icons

Lucide, outline, stroke width 1.8 (`lucide-react` on the web, `lucide-react-native` on mobile).

| Meaning  | Icon          |
| -------- | ------------- |
| Like     | Heart         |
| Pass     | X             |
| Chat     | MessageCircle |
| Matches  | Users         |
| Profile  | UserRound     |
| Verified | ShieldCheck   |
| Report   | Flag          |
| Block    | Ban           |
| Settings | Settings      |
| Alerts   | Bell          |

## Mood

Indian-inspired patterns and college illustrations stay subtle, and never sit behind text
that must be read. The illustrations are placeholders (`packages/ui-web/assets/`,
`apps/mobile/assets/illustrations/`) until final art arrives: replace the SVG files, keep the
names.

## Product rules the design does not change

- Sign-in is college email only (no "Continue with Google").
- No "Online" or "Typing…" indicators; at most the coarse "Active recently".
- Photos: at least 2, at most 6.
- Read receipts are off by default.
- Only fields that exist in our data are shown.
- Report and Block are reachable on every profile and chat.
