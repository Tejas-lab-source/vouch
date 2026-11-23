# @vouch/i18n

The user-facing strings of every client, with a small `t(key, params)` helper. Apps contain no
hard-coded user-facing text.

- `t(key, params)` looks up English. `{name}` placeholders are filled from `params`.
- `createTranslator(locale)` builds a translator for a locale. Only `en` exists in v1.
- A missing key throws, so a typo fails in tests rather than showing a raw key.
- `src/en.js` holds the strings, grouped by screen (`auth.*`, `home.*`, `ui.*`, `errors.*`).
