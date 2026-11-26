# @vouch/ui-native

The React Native UI kit for `apps/mobile`, on `@vouch/ui-tokens`. It has the same components as
`@vouch/ui-web` (with `Sheet` in place of `Modal`), plus `Text` (the type styles with the
bundled fonts), built on React Native primitives with accessibility roles and labels and 44 pt
targets. `useTheme()` picks the light or dark tokens from the system setting and gives
`font(name)` for text styles. Icons are `lucide-react-native` at 1.8 stroke; the wordmark is
drawn with `react-native-svg`. The app loads the fonts (`@expo-google-fonts/*`) at start-up.
