# @vouch/features-core

Platform-neutral app logic shared by web and mobile, and the feature registry.

- **Registry:** `SLOTS` lists the named UI slots. `defineClientFeature` checks slot names and
  ids at start-up. `createFeatureRegistry().itemsFor(slot, flags)` returns a slot's items in
  order, without the items of features whose flag is off.
- **Auth:** `createAuthFlow` is the sign-in state machine: email, then code, then (first time)
  birth date and consent, then signed in. `errorKey` maps API errors to i18n keys.
- **React glue:**
  - `AppServicesProvider` / `useServices`
  - `useSession`, `useConfig` (`GET /v1/config`) and `useFlags`
  - `<Slot name>` and `useSlotItems`

A new screen part is a new feature that registers into a slot. Existing screens are not edited.
Component tests run in jsdom.
