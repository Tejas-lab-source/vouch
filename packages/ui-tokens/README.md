# @vouch/ui-tokens

The design tokens of Vouch: **Direction E — Modern Indian, trustworthy, fun**. The source of
truth for the values is `docs/design/design-system.md`; this package is where they live in
code, once, for the web, mobile and the landing page. To change the brand, change it here.

- `light` / `dark` colours (dark mode is its own palette, not an inversion). The spec colours
  (`primary`, `secondary`, `background`, `surface`, `text`, `textMuted`, `success`, `danger`)
  plus text-only variants (`primaryText`, `dangerText`, `successText`) where a spec colour is
  under 4.5:1 as text; each adjustment is listed in the design-system doc
- `type` (H1, H2, Body, Caption, plus Label), `fonts`, `fontStack` (CSS) and
  `nativeFontFamily` (the bundled font files React Native uses)
- `space` (4–48), `radius` (cards 16, buttons 24, inputs 16, chips 20, modals 24),
  `shadow` (CSS) and `nativeShadow`, `icon` (Lucide at 1.8 stroke), `motion`,
  `minTouchTarget` (44 px)
- `wordmark`: the "Vouch" wordmark and heart as SVG paths
- `cssVariables()`: the tokens as CSS custom properties, for `:root`, `[data-theme='dark']`
  and `prefers-color-scheme: dark` (used by `@vouch/ui-web/styles.css` and the landing page)
- `CONTRAST_PAIRS`, `THEME_PAIRS` and `contrast()`: a test checks every text/background pair
  the components use against WCAG AA (4.5:1 for text, 3:1 for outlines and icons) in both
  themes
