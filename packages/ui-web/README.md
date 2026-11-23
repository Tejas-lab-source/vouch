# @vouch/ui-web

The web UI kit: Button, Input, OtpInput, Avatar, Card, Modal (a native `<dialog>`, a bottom
sheet on narrow screens), Toast, EmptyState, Skeleton, ListItem and Badge.

The components are accessible by default:

- real buttons and labelled fields; hints and errors linked with `aria-describedby`
- a visible focus ring and 44 px touch targets
- `prefers-reduced-motion` respected
- light and dark themes, through `data-theme` or the system setting

Import `@vouch/ui-web/styles.css` once. It is generated (`node scripts/build-css.js`) from
`@vouch/ui-tokens` plus `src/components.css`, and a test fails when the committed file is
stale. The web app's `/ui-kit` route shows every component.
