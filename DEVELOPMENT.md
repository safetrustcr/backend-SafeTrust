# Development

## Node.js manifests

The repository has two `package.json` files with separate purposes:

- The root `package.json` is a command shim for repository-level workflows.
  Its `start`, `dev`, and `build` scripts delegate to `webhook/`; its type-check
  and test scripts do the same. Keep application dependencies out of this
  manifest.
- `webhook/package.json` is the authoritative manifest for the webhook
  application and its tooling. Add or update application dependencies there,
  and run its scripts from the repository root with `npm --prefix webhook`.

Docker and CI install dependencies from `webhook/` directly. The root manifest
has no application dependencies or lockfile; `webhook/package-lock.json`
governs application dependencies.

## Test layout

Tests are placed by what they need to run:

- Unit tests live next to the code they cover, in the `__tests__/` folder of
  that module under `webhook/src/` (for example
  `webhook/src/services/__tests__/reconciliation.service.test.ts`). Mock the
  I/O boundaries (`services/db`, `services/hasura`, the `https` module) instead
  of opening a connection.
- Tests that need a real database or another external service live in
  `webhook/tests/integration/`.

`jest.roots` in `webhook/package.json` mirrors those two locations, and
`tsconfig.test.json` type-checks both, so `npm --prefix webhook run type-check`
and the Jest steps in CI follow the same layout. Move a test when its
dependencies change; do not keep a second copy in the other location.
