# @vouch/admin

The staff console (React and Vite).

- **Sign-in:** email, password and TOTP (see ADR 0018). The staff token is kept in memory
  only, so reloading the page means signing in again.
- **Panels:** lists the panels from `GET /v1/admin/panels`. Phase 13 renders them.

Accounts are created with `node apps/api/scripts/admin-create.js`.
