# 📚 backend-SafeTrust Documentation

Reference documentation for the SafeTrust backend — Hasura GraphQL, PostgreSQL,
the webhook service, and the multi-tenant deployment tooling.

For setup and day-to-day commands, start with the [root README](../README.md).

---

## Database

| Document | What it covers |
|---|---|
| [SafeTrust Schema Migration Strategy](migrations/safetrust-schema-migration.md) | Why SafeTrust tables moved from `public` to the `safetrust` schema, the deployment and rollback sequences, and the Hasura metadata YAML changes that go with them |

---

## Related reading in the root README

- [🏗️ Metadata Architecture](../README.md#️-metadata-architecture) — how
  `metadata/base` and `metadata/tenants/*` are merged and deployed
- [🛠️ Manual Commands](../README.md#️-manual-commands-optional) — per-tenant
  migration, metadata, and seed commands
- [Rollback migrations](../README.md#rollback-migrations) — rolling back a
  tenant's migrations with `hasura migrate apply --type down`

---

## Contributing to the docs

Documentation changes follow the same conventions as code changes — see
[CONTRIBUTORS_GUIDELINE.md](../CONTRIBUTORS_GUIDELINE.md) and
[GIT_GUIDELINE.md](../GIT_GUIDELINE.md). Use a `docs/` branch prefix and a
`docs:` commit type.

Diagrams are written as [Mermaid](https://mermaid.js.org) fenced code blocks so
they render on GitHub without a build step. Two house rules keep them portable
across GitHub, GitBook, and standalone Mermaid renderers:

- At most **2** `\n` line breaks per node label
- No subgraph nested more than **1** level deep
