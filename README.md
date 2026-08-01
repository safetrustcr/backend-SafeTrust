<div align="center">
<img src="https://raw.githubusercontent.com/safetrustcr/frontend-SafeTrust/develop/public/img/logo.png" alt="SafeTrust Logo" width="80" />

# backend-SafeTrust
**Hasura GraphQL · PostgreSQL · Webhook Service · Multi-tenant**

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](https://opensource.org/licenses/MIT)
[![Hasura](https://img.shields.io/badge/Hasura-GraphQL-1EB4D4?logo=hasura)](https://hasura.io)
[![Stellar](https://img.shields.io/badge/Stellar-Blockchain-7B2BF9?logo=stellar)](https://stellar.org)
[![🔐 TrustlessWork](https://img.shields.io/badge/🔐_TrustlessWork-EaaS-00C2A8)](https://docs.trustlesswork.com/trustless-work)
[![💧 Drips Wave](https://img.shields.io/badge/💧_Drips-Wave-7B2BF9)](https://www.drips.network/wave)
[![🦊 GrantFox](https://img.shields.io/badge/🦊_GrantFox-GrantFox-FF6B00)](https://grantfox.xyz/)
</div>

---

## What is this repo?

The backend infrastructure for SafeTrust — a decentralized P2P escrow platform for rental transactions on the Stellar blockchain. This repo contains:

- **Hasura GraphQL Engine** — auto-generated API with JWT auth and row-level permissions
- **PostgreSQL** — multi-tenant schema (`safetrust` + `hotel_industry`)
- **Webhook service** — Node/Express, handles Firebase auth sync and escrow lifecycle events
- **Migrations + seeds** — versioned schema and dev data for both tenants

---

## Quick Start

### Prerequisites

| Tool | Version |
|---|---|
| Docker + Docker Compose | ≥ 24 |
| Hasura CLI | ≥ 2.x |
| curl | any |

> **Windows:** run `bin/dc_prep` inside WSL (Ubuntu) or Git Bash.

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

> ⚠️ `HASURA_GRAPHQL_JWT_SECRET` must be valid JSON with a key of at least 32 characters. `dc_prep` will fail if this is malformed.

### 2. Start everything

```bash
bin/dc_prep
```

`dc_prep` runs in order:

| Step | Action |
|---|---|
| 1 | Start `postgres`, `graphql-engine`, `webhook` containers |
| 2 | Poll `GET /healthz` until Hasura is ready (up to 3 min) |
| 3 | Build and deploy tenant metadata for all tenants |
| 4 | Apply all migrations per tenant |
| 5 | Reload Hasura metadata |
| 6 | Apply seed data per tenant |

**Target a specific tenant:**
```bash
bin/dc_prep safetrust          # one tenant
bin/dc_prep safetrust hotel_industry  # both explicitly
```

### 3. Open Hasura console

```bash
bin/dc_console
```

### Reset the database

```bash
docker compose down -v
bin/dc_prep
```

---

## Metadata Architecture

```bash
metadata/
├── base/ ← shared Hasura config across all tenants
├── tenants/
│ ├── safetrust/ ← apartments, escrows, users, wallets
│ └── hotel_industry/ ← hotels, rooms, reservations, escrow_transactions
├── build/ ← generated output (tenants merged with base), ready to deploy
├── build-metadata.sh
├── deploy-tenant.sh
└── setup-tenant.sh ← runs build + deploy in one command ✅
```

---

## 🔧 Manual Commands

> `bin/dc_prep` handles all of these automatically. Use these only when targeting a specific step in isolation.

### Metadata — single tenant

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

Apply a single version:

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

---

## Karate Tests

API tests using the [Karate framework](https://docs.karatelabs.io/), running in Docker.

```bash
docker compose -f docker-compose-test.yml run --rm --build karate
```

Reports generated at `tests/results/karate-summary.html` and `tests/results/karate-tags.html`.

**Add new tests:** create `.feature` files in `tests/karate/features/` — picked up automatically.

**Config files:**
- `tests/karate/src/test/resources/karate-config.js`
- `docker-compose-test.yml`
- `Dockerfile.test`

---

## Contributing

1. `bin/dc_prep` must complete without errors.
2. No raw SQL outside of `migrations/` — all schema changes go through versioned migration files.
3. Never edit a migration that has already been applied — add a new one instead.
4. Link the issue your PR closes.

**Branch naming:** `feat/<issue-number>-short-description` · `fix/<issue-number>-short-description`

- [Contributing Guide](https://github.com/safetrustcr/Frontend/issues/34)
- [Git Guidelines](https://github.com/safetrustcr/Frontend/issues/35)

---

## License

© 2026 SafeTrust. Released under the [MIT License](https://opensource.org/license/MIT).
