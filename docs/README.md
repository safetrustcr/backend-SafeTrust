# 📚 SafeTrust Backend Documentation

Reference documentation for the **SafeTrust** backend — Hasura GraphQL, PostgreSQL, the multi-tenant engine, smart contract escrow lifecycle, and operational tooling.

For setup and day-to-day commands, start with the [root README](../README.md).

---

## 📖 Quick Links & Index

### 🏗️ Architecture
| Document | Description |
|---|---|
| [Multi-Tenant Architecture](architecture/multi-tenant.md) | Two-tenant isolation model (`safetrust` and `hotel_industry`), schema routing, and RBAC rules |
| [Rust Crates in SafeTrust](architecture/rust-crates.md) | High-assurance native extensions via Neon bindings for cryptography and blockchain operations |

### 🔐 Stellar & Escrow Flows
| Document | Description |
|---|---|
| [Escrow Lifecycle](stellar/escrow-lifecycle.md) | Full TrustlessWork Stellar smart contract escrow state machine and transitions |
| [Fund Escrow](stellar/fund-escrow.md) | Workflow and validation sequence for funding guest reservation escrows |
| [Approve Milestone](stellar/approve-milestone.md) | Milestone verification and approval lifecycle for escrow funds |
| [Release Funds](stellar/release-funds.md) | Payout release mechanisms and on-chain settlement execution |

### 🐘 Database & Migrations
| Document | Description |
|---|---|
| [SafeTrust Schema Migration Architecture](migrations/safetrust-schema-migration.md) | Comprehensive architecture, Mermaid diagrams, deployment sequence, and rollback procedures for migration `1779300000001_migrate_to_safetrust_schema` |

### 🚀 Infrastructure & Tooling
| Document | Description |
|---|---|
| [bin/start Guide](infra/bin-start.md) | Container startup orchestration, database health checks, and tenant initialization |
| [bin/deploy_init Guide](infra/deploy-init.md) | Sequential vs. parallel tenant deployment benchmarking protocol |

---

## 🗺️ Documentation Roadmap

The following pages are part of the docs roadmap and will be linked as they land:

- **Architecture Overview** — full system diagram (planned)
- **Dispute & Resolve** — dispute flow diagram (planned)
- **x402 Protocol** — AI agent payment flow (planned)
- **ZK Privacy Layer** — zero-knowledge circuits (planned)
- **Wave Guide** — contribution waves (planned)

---

## 🛠️ Related Reading in the Root README

- [🏗️ Metadata Architecture](../README.md#️-metadata-architecture) — how `metadata/base` and `metadata/tenants/*` are merged and deployed
- [🛠️ Manual Commands](../README.md#️-manual-commands-optional) — per-tenant migration, metadata, and seed commands
- [Rollback migrations](../README.md#rollback-migrations) — rolling back a tenant's migrations with `hasura migrate apply --type down`

---

## 🤝 Contributing to the Docs

Documentation changes follow the same conventions as code changes — see [CONTRIBUTORS_GUIDELINE.md](../CONTRIBUTORS_GUIDELINE.md) and [GIT_GUIDELINE.md](../GIT_GUIDELINE.md). Use a `docs/` branch prefix and a `docs:` commit type.

Diagrams are written as [Mermaid](https://mermaid.js.org) fenced code blocks so they render on GitHub without a build step. Two house rules keep them portable across GitHub, GitBook, and standalone Mermaid renderers:

- At most **2** `\n` or `<br/>` line breaks per node label
- No subgraph nested more than **1** level deep
