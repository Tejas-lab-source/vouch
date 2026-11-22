# @vouch/domain

Pure client-side rules shared by web and mobile. No React, no I/O.

- `ageOn` / `isAdult`: the same 18+ rule as the backend's identity domain, so the client
  refuses what the server would
- `isIsoDate`, `isEmail` and `isOtp`: form validators
- `relativeTime` and `formatCount`: display formatting (`"5 min"`, `"99+"`)
- `compareVersions`: the forced-update check against `minSupportedVersion` from
  `GET /v1/config`
