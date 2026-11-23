# @vouch/admin

The staff console (React and Vite).

- **Sign-in:** email, password and TOTP (see ADR 0018). The staff token is kept in memory
  only, so reloading the page means signing in again.
- **Panels** (from `GET /v1/admin/panels`, filtered by role) are rendered generically:
  - list columns by `kind` (text, timestamp, status, user, image, json), paging and the detail
    view
  - actions: each asks for confirmation (and a note where the definition says so), then shows
    the audit entry it created
  - a row's own id (its first `id`/`…Id` field) fills the action's `{id}`
- **User lookup** finds a user by public id; admins can ban from there.
- **Flags:** the panel has an on/off toggle per flag.

Accounts are created with `node apps/api/scripts/admin-create.js`.
