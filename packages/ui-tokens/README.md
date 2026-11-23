# @vouch/ui-tokens

The design tokens of "Vouch": a neutral, placeholder brand with light and dark themes.

- `light` / `dark` colours, `space`, `radius`, `type` (type scale), `fontFamily`, `motion` and
  `minTouchTarget` (44 px)
- `cssVariables()`: the same tokens as CSS custom properties, for `:root`,
  `[data-theme='dark']` and `prefers-color-scheme: dark` (used to build `@vouch/ui-web`'s
  `styles.css`)
- `CONTRAST_PAIRS` and `contrast()`: a test checks every text/background pair against WCAG AA
  (4.5:1 for text, 3:1 for large text and UI) in both themes
