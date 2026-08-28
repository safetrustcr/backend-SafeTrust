
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
├── deploy-tenant.sh
└── setup-tenant.sh      ← runs build + deploy in one command ✅

```

---

## 🛠️ Manual Commands (optional)

> `bin/start` handles all of these automatically. Use these only when targeting a specific step in isolation.

### Deploy metadata — single tenant

```bash
cd metadata
./setup-tenant.sh safetrust --endpoint http://localhost:8080 --admin-secret myadminsecretkey

```

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

## ⏱️ Benchmarking Protocol

`bin/deploy_init` is an experimental benchmarking tool for evaluating parallel deployment vs the canonical sequential path.

Contributors run both scripts from identical starting conditions and record the JSON output:

### Round 1 — Amdahl baseline (sequential, N=2)
```bash
docker compose down -v
bin/start safetrust hotel_industry # canonical path
# record: tests/results/deploy_timings_sequential_N2.json

docker compose down -v
bin/start # infrastructure only
bin/deploy_init safetrust hotel_industry # PARALLEL_DEPLOY=false
# record: tests/results/deploy_init_timings_sequential_N2.json
```

### Round 2 — Gustafson parallel (N=2)
```bash
docker compose down -v
bin/start
PARALLEL_DEPLOY=true bin/deploy_init safetrust hotel_industry
# record: tests/results/deploy_init_timings_parallel_N2.json
```

### Round 3 — Gustafson scaling (N=5, simulated)
```bash
# Simulate 5 tenants by deploying same 2 tenants with 3 aliases
# This validates the parallel execution model without requiring real tenant data
docker compose down -v
bin/start
PARALLEL_DEPLOY=true bin/deploy_init \
  safetrust hotel_industry safetrust hotel_industry safetrust
# record: tests/results/deploy_init_timings_parallel_N5.json
```

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

**Config files:**

- `tests/karate/src/test/resources/karate-config.js`
- `docker-compose-test.yml`
- `Dockerfile.test`

> 📍`bin/test` runs `docker compose -f docker-compose-test.yml run --rm --build karate` internally.

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
