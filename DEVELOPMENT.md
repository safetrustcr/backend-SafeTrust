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
