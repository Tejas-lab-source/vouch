# `_example` (test only)

A minimal module that proves the platform kernel end to end:
HTTP → use case → outbox → relay → consumer → inbox, with the trace id carried through.
It is **never** listed in `src/modules/index.js`; only `apps/api/test/platform/example-e2e.test.js`
boots it.

- **Public API (`api.js`):** `createNote(input, ctx)`.
- **Events emitted:** `example.note_created.v1` (test-only, defined in `contract.js`).
- **Events consumed:** `example.note_created.v1` (records into an injected test sink).
- **Tables owned:** none. It runs as the test-created role `vouch_example`.

Use `scripts/new-module.js` to scaffold real modules with the same layout.
