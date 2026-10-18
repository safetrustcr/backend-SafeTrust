
<div align="center">
  <img src="https://raw.githubusercontent.com/safetrustcr/frontend-SafeTrust/develop/public/img/logo.png" alt="SafeTrust Logo" width="90" />

  # 🛡️ backend-SafeTrust
  **⚡ Hasura GraphQL · 🐘 PostgreSQL · 🪝 Webhook Service · 🏢 Multi-tenant**

  [![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](https://opensource.org/licenses/MIT)
  [![Hasura](https://img.shields.io/badge/Hasura-GraphQL-1EB4D4?logo=hasura)](https://hasura.io)
  [![Stellar](https://img.shields.io/badge/Stellar-Blockchain-7B2BF9?logo=stellar)](https://stellar.org)
  [![🔐 TrustlessWork](https://img.shields.io/badge/🔐_TrustlessWork-EaaS-00C2A8)](https://docs.trustlesswork.com/trustless-work)
  [![💧 Drips Wave](https://img.shields.io/badge/💧_Drips-Wave-7B2BF9)](https://www.drips.network/wave)
  [![🦊 GrantFox](https://img.shields.io/badge/🦊_GrantFox-GrantFox-FF6B00)](https://grantfox.xyz/)
</div>

---

## 📖 Table of Contents
- [🔍 What is this repo?](#-what-is-this-repo)
- [🚀 Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [1. Set up environment variables](#1-set-up-environment-variables)
  - [2. 🔮 Start everything](#2--start-everything)
  - [Reset the database](#reset-the-database)
  - [Rollback migrations](#rollback-migrations)
- [🏗️ Metadata Architecture](#️-metadata-architecture)
- [📚 Documentation](#-documentation)
- [🛠️ Manual Commands (optional)](#️-manual-commands-optional)
- [🥋🔬 Karate Tests](#-karate-tests)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## 🔍 What is this repo?

The backend infrastructure for **SafeTrust** — a decentralized P2P escrow platform for rental transactions on the Stellar blockchain. This repo contains:

- ⚡ **Hasura GraphQL Engine** — auto-generated API with JWT auth and row-level permissions
- 🐘 **PostgreSQL** — multi-tenant schema (`safetrust` + `hotel_industry`)
- 🪝 **Webhook service** — Node/Express, handles Firebase auth sync and escrow lifecycle events
- 📂 **Migrations + seeds** — versioned schema and dev data for both tenants

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version |
|---|---|
| Docker + Docker Compose | ≥ 24 |
| Hasura CLI | ≥ 2.x |
| curl | any |

> 💡 **Windows Note:** Run `bin/start` inside WSL (Ubuntu) or Git Bash.

### 1. Set up environment variables

```bash
cp .env.example .env

```

Fill in `.env` before running anything:

```dotenv
POSTGRES_PASSWORD=your_postgres_password

# Must be valid JSON, key ≥ 32 characters for HS256
HASURA_GRAPHQL_JWT_SECRET={"type":"HS256","key":"replace-with-min-32-char-secret-here"}

HASURA_EVENT_SECRET=your_event_secret

```

> ⚠️ `HASURA_GRAPHQL_JWT_SECRET` must be valid JSON with a key of at least 32 characters. `start` will fail if this is malformed.

### 2. 🔮 Start everything

```bash
bin/start tenant-name tenant-name

```

`start` runs in order:

| Step | Action |
| --- | --- |
| 1 | Start `postgres`, `graphql-engine`, `webhook` containers |
| 2 | Poll `GET /healthz` until Hasura is ready (up to 3 min) |
| 3 | Build and deploy tenant metadata for all tenants |
| 4 | Apply all migrations per tenant |
| 5 | Reload Hasura metadata |
| 6 | Apply seed data per tenant in parallel, with one transaction per seed file |

Seed files are applied directly with PostgreSQL and `ON_ERROR_STOP=1`. Each file
is wrapped in `BEGIN`/`COMMIT`, so a failed file rolls back completely; the two
independent tenants run concurrently. Seed inserts use conflict-safe or
stable-key cleanup patterns, making `bin/start` safe to rerun without
`docker compose down -v`.

Set `SEED_CHUNK_SIZE` in `.env` to tune the configured seed batch size (default
`500`).

**Target a specific tenant:**

```bash
bin/start safetrust                 # one tenant
bin/start safetrust hotel_industry # both explicitly

```

### Reset the database

```bash
bin/start --reset safetrust

```

`--reset` removes the Docker volumes before starting, so tenant data is
recreated by migrations and seeds. To recreate the containers while keeping
the database volumes, use:

```bash
bin/start --restart safetrust
```

### Rollback migrations

```bash
# Rollback safetrust migrations:
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --down all

# Rollback hotel_industry migrations:
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name hotel_industry \
  --down all

```

---

## 🏗️ Metadata Architecture

```bash
metadata/
├── base/                ← shared Hasura config across all tenants
├── tenants/
│   ├── safetrust/       ← apartments, escrows, users, wallets
│   └── hotel_industry/  ← hotels, rooms, reservations, escrow_transactions
├── build/               ← generated output (tenants merged with base), ready to deploy
├── build-metadata.sh
├── deploy-tenant.sh     ← applies complete metadata for a tenant
└── setup-tenant.sh      ← runs build + deploy in one command ✅

```

`deploy-tenant.sh` deploys the **complete** metadata document for a tenant:
source configuration, table configuration, select/insert/update/delete
permissions, object/array relationships, event triggers, tracked functions,
and shared metadata (actions, cron triggers, inherited roles, …).

It works by exporting the metadata currently on the server, replacing only the
target tenant's source with the built metadata, and applying the full document
with `replace_metadata`. This means:

- re-deploying an already-tracked table applies changed permissions and
  relationships instead of skipping it;
- deploying one tenant preserves every other tenant's source and all shared
  metadata;
- migrations are validated first, so permissions are never applied to a table
  that has not been migrated yet;
- `get_inconsistent_metadata` and representative guest/host role checks run
  after the apply, and any failure fails the deployment with an explicit error.

Within the tenant being deployed, the built metadata is authoritative: objects
missing from it (for example a removed table) are dropped on the next re-deploy,
while other tenants and shared metadata are preserved.

Deploy metadata for several tenants sequentially — `setup-tenant.sh` and
`bin/start` already serialize metadata deployment for this reason.

---

## 🛠️ Manual Commands (optional)

> `bin/start` handles all of these automatically. Use these only when targeting a specific step in isolation.

### Deploy metadata — single tenant

```bash
cd metadata
./setup-tenant.sh safetrust --endpoint http://localhost:8080 --admin-secret myadminsecretkey

```

### Deploy metadata — Hasura Cloud

Local commands default to `http://localhost:8080`. Cloud deployments need an
explicit target endpoint and an explicit admin secret — keep the secret in
`HASURA_GRAPHQL_ADMIN_SECRET` rather than on the command line so it does not
appear in process listings or shell history:

```bash
# Admin secret comes from the environment; set it in .env or your secret store
export HASURA_GRAPHQL_ADMIN_SECRET=...
export HASURA_GRAPHQL_ENDPOINT=https://<project>.hasura.app

# Apply migrations before permissions/relationships are deployed
hasura migrate apply --database-name safetrust

cd metadata
./setup-tenant.sh safetrust --cloud --endpoint "$HASURA_GRAPHQL_ENDPOINT"

```

The `--cloud` flag rejects local or non-https endpoints and refuses the local
default admin secret. The same flags work with `deploy-tenant.sh`:

```bash
HASURA_GRAPHQL_ADMIN_SECRET=... ./deploy-tenant.sh safetrust \
  --cloud --endpoint https://<project>.hasura.app

```

Set `HASURA_GRAPHQL_ENDPOINT` instead of `--endpoint` when a tool reads the
target from the environment. Never commit the admin secret, and never paste it
into an issue or CI log.

### Migrations — single tenant

```bash
hasura migrate apply \
  --database-name safetrust \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey

```

### Apply a single version

```bash
hasura migrate apply \
  --database-name safetrust \
  --version <timestamp> \
  --type up \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey

```

### Seeds — single tenant

```bash
hasura seed apply \
  --database-name safetrust \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey

```

For the same transactional behavior as startup, use `bin/start` for seed
application rather than invoking `hasura seed apply` directly.

---


## 📚 Documentation

In-depth guides live in [`docs/`](docs/README.md).

| Document | What it covers |
|---|---|
| [SafeTrust Schema Migration Strategy](docs/migrations/safetrust-schema-migration.md) | Why SafeTrust tables moved from `public` to the `safetrust` schema, plus the deployment and rollback sequences |

---

## 🥋🔬 Karate Tests

API tests using the [Karate framework](https://docs.karatelabs.io/), running in Docker.

```bash
bin/test # start karate testing
```

Reports are generated at:

- `tests/results/karate-summary.html`
- `tests/results/karate-tags.html`

**Add new tests:** Create `.feature` files in `tests/karate/features/` — picked up automatically.

### Metadata deployment tests

The metadata deployer has its own tests that need no Docker or Hasura instance:
a stateful mock Hasura server plus a stub Hasura CLI. They cover fresh and
repeated deploys, configuration drift, failed metadata API responses,
multi-tenant preservation, migration validation, inconsistent metadata, role
verification, and Cloud target guards.

```bash
bin/test-metadata
```

Dependencies: `jq`, `curl`, `python3`, and mikefarah `yq` v4. The same command
runs in the `metadata deploy tests` GitHub workflow.

**Config files:**

- `tests/karate/src/test/resources/karate-config.ts` (compiled to the JavaScript Karate loads)
- `docker-compose-test.yml`
- `Dockerfile.test`

> 📍`bin/test` uses an isolated `safetrust-test` Compose project and excludes the `@timing` benchmark, which requires a separate `bin/start safetrust` timing report. It runs `docker compose -p safetrust-test -f docker-compose-test.yml run --rm --build karate` internally.

## TypeScript sources and builds

Webhook runtime code and tests live in `webhook/src/**/*.ts`. Production builds
exclude test files; `type-check` checks both runtime and test sources in strict mode.

```bash
npm --prefix webhook ci
npm --prefix webhook run type-check
npm --prefix webhook test
npm --prefix webhook run build
```

Native-addon helpers, fallback loaders, benchmarks, and examples use TypeScript
sources under `crates/`. Run `npm --prefix webhook run build:tooling` before invoking
their JavaScript entry points directly. `build:rust` and `test` do this automatically.
The adjacent `.js` files are generated compatibility outputs; edit the `.ts` sources.

Karate configuration and token helpers are also authored in TypeScript. The test
image compiles them automatically. For a local Java runner, first run
`npm --prefix webhook run build:karate` to generate Karate's required `.js` files.
Karate expects a function expression, so its compiler configuration omits a leading
strict-mode directive while retaining strict TypeScript checks. Runtime payload
validation and native-verifier fail-closed checks remain necessary.

## 🤝 Contributing

1. `bin/start` must complete without errors.
2. No raw SQL outside of `migrations/` — all schema changes go through versioned migration files.
3. Never edit a migration that has already been applied — add a new one instead.
4. Link the issue your PR closes.

**Branch naming:** `feat/<issue-number>-short-description` · `fix/<issue-number>-short-description`

* 📋 [Contributing Guide](https://github.com/safetrustcr/Frontend/issues/34)
* 🌿 [Git Guidelines](https://github.com/safetrustcr/Frontend/issues/35)

---

## 📄 License

© 2026 SafeTrust. Released under the [MIT License](https://opensource.org/license/MIT).
