# profiles

Each user's profile, preferences, photos (metadata only) and sections, and the profile cards
other modules show. Photo files are owned by media; profiles stores only their object keys.

## Public API (`api.js`)

| Function        | Returns                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `getCards(ids)` | `ProfileCard`s of active profiles, in the order asked; others are skipped |
| `getCard(id)`   | One card or `null`                                                        |

Cards are cached in Redis as `profiles:card:{userId}` for 10 minutes and invalidated on every
change. The `profiles.cardFields` pipeline (owned here, empty in v1) runs on every read, after
the cache.

## HTTP routes (contracts in `packages/contracts/src/http/profiles.js`)

| Route                                | Auth | Use case                                                                |
| ------------------------------------ | ---- | ----------------------------------------------------------------------- |
| `GET /v1/me/profile`                 | user | `getMyProfile` (creates the empty profile if `user.created.v1` is late) |
| `PATCH /v1/me/profile`               | user | `updateMyProfile`: name, gender, interests, bio, age range              |
| `PUT /v1/me/profile/sections/{type}` | user | `putSection`: validated against the `sections` registry (empty in v1)   |
| `DELETE /v1/me/photos/{id}`          | user | `deleteMyPhoto`: idempotent; files are released through media           |

## Events

- **Emits:** `profile.updated.v1` on every change, with the `changed` fields (plus `status`
  when the status changed). Creating the empty profile emits nothing.
- **Consumes:**
  - `user.created.v1`: creates exactly one empty, `pending` profile (age range 18–30).
  - `photo.uploaded.v1`: shows the photo as `pending` at the smallest free position.
  - `photo.approved.v1`, `photo.rejected.v1`: update the photo and the profile's status. A
    photo the owner deleted stays deleted, and its late result is released.
  - `user.deleted.v1`: deletes the photo files through `media.deleteObjects`, then the
    profile (photos and sections cascade).

## Tables owned (schema `profiles`)

`profiles`, `photos`, `profile_sections`. View: `profiles.candidates_v` (for discovery).
A deleted photo keeps a `deleted` row without keys (a tombstone) so it cannot come back.

## Rules

- **Complete** (status `active`): a name, a gender, at least one interest
  (`interested_in`) and at least 2 approved photos. Otherwise `pending`. A completed profile
  that loses a photo goes back to `pending`. `hidden` is never left by an edit.
- **Own view:** deleted photos are hidden; rejected photos stay visible with `urls: null`.
- **Cards** show approved photos only, age (never the birth date) and the college name.

## Adapters

`pg/stores.js`, `redis/card-cache.js` (fails open), `http/routes.js`, `events/consumers.js`.
