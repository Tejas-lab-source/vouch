# @vouch/ui-web

The web UI kit, on `@vouch/ui-tokens`: Button (primary, secondary, ghost, danger, with an
optional icon), IconButton (round), Input, OtpInput (six boxes over one real field), Avatar,
Card, Modal (a native `<dialog>`, a bottom sheet on narrow screens), Toast (success and error
icons), EmptyState (optional art), Skeleton, ListItem, Badge, StatusBadge (verified, pending,
rejected), Chip, Icon (Lucide at 1.8 stroke), Wordmark and Illustration. The Lucide icons the
design uses are re-exported.

The components are accessible by default:

- real buttons and labelled fields; hints and errors linked with `aria-describedby`
- a visible focus ring and 44 px touch targets
- `prefers-reduced-motion` respected
- light and dark themes, through `data-theme` or the system setting

Import `@vouch/ui-web/fonts.css` (self-hosted Poppins and Inter) and
`@vouch/ui-web/styles.css` once. `styles.css` is generated (`node scripts/build-css.js`) from
`@vouch/ui-tokens` plus `src/components.css`, and a test fails when the committed file is
stale. The web app's `/ui-kit` route shows every component.

`assets/` holds the illustrations. They are clearly-marked placeholders until the final art
arrives: replace a file and keep its name.
