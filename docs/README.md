# 📚 SafeTrust Backend Documentation

Reference documentation for the **SafeTrust** backend — Hasura GraphQL, PostgreSQL, the multi-tenant engine, smart contract escrow lifecycle, and operational tooling.

> **Documentation rule:** Pages under `docs/` describe the code as it is today. History lives in git, PRs, ADRs ([`adr/`](#architecture-decision-records-adrs)), and [`history/`](#history). Any PR that changes behavior must update the corresponding page in the same PR.

For setup and day-to-day commands, start with the [root README](../README.md).

---

## 📖 Quick Links & Index

### 🏗️ Architecture
| Document | Description |
|---|---|
| [Architecture Overview](architecture/overview.md) | System layers, unsigned XDR signing, and indexer reconciliation |
| [Multi-Tenant Architecture](architecture/multi-tenant.md) | Two-tenant isolation model (`safetrust` and `hotel_industry`), schema routing, and RBAC rules |
| [Safetrust Permissions](architecture/safetrust-permissions.md) | Role-scoped Hasura permissions (`guest`, `host`, `admin`) across `safetrust` tables and actions |
| [Rust Crates in SafeTrust](architecture/rust-crates.md) | High-assurance native extensions via Neon bindings for cryptography and blockchain operations |
| [Crate Boundaries](architecture/crate-boundaries.md) | Consumers, exports, fallbacks, dispositions, and quarantine gates for all eight Rust crates |
| [Escrow Claims API](architecture/escrow-claims-api.md) | Request and response contract, error codes, idempotency and rate limit for claims on released escrows |
| [Reservations API](architecture/reservations-api.md) | Lifecycle, allowed actions computation, read endpoints, and safe cancellation protocol |
| [Wallet Registry API](architecture/wallets-api.md) | Verified wallet management lifecycle (list, unlink, and atomic set-primary endpoints) |
| [Hotel Conversation Notifications](architecture/hotel-conversation-notifications.md) | In-process lifecycle notifications, time budget, and idempotent conversation creation |
| [Error Handling, Logging and CORS](architecture/error-handling-and-logging.md) | Typed `AppError` mapping, sanitized 5xx bodies, structured logs with `requestId`, raw-body capture, and the CORS origin policy |

### 🔐 Stellar & Escrow Flows
| Document | Description |
|---|---|
| [Escrow Lifecycle](stellar/escrow-lifecycle.md) | Full TrustlessWork Stellar smart contract state machine, retry mechanics, and fund, approve, release, and dispute/resolve flows |
| [Escrow State Source & Reconciliation](stellar/reconciliation.md) | Polling architecture, Trustless Work V1 indexer endpoint, status derivation, field mapping, and Soroban adapter validation |
| [x402 Protocol](stellar/x402-protocol.md) | Agentic payments on Stellar using Soroban authorization entries and USDC SEP-41 |

### 📊 Analytics
| Document | Description |
|---|---|
| [Analytics Console Runbook](analytics/console-runbook.md) | Hasura Console verification queries, role checks, and Karate test procedures for analytics functions |
| [Analytics Metric Dictionary](analytics/metrics.md) | Definitions, currency/UTC conventions, and dashboard labels for all analytics fields |

### 🚀 Infrastructure & Tooling
| Document | Description |
|---|---|
| [bin/start Guide](infra/bin-start.md) | Container startup orchestration, database health checks, and tenant initialization |

### 📜 Architecture Decision Records (ADRs)
<a id="architecture-decision-records-adrs"></a>
| Document | Description |
|---|---|
| [ADR-0001: ZK Eligibility Statement and Trust Model](adr/0001-zk-eligibility-statement-and-trust-model.md) | *(Superseded by #753)* Predicate specification, trust boundaries, feasibility trade-offs, and verification key pinning for escrow admission |

### 🕰️ History
<a id="history"></a>
| Document | Description |
|---|---|
| [Investigation: Missing `users` GraphQL Operations (#666)](history/hasura-users-schema-666.md) | *(Historical)* Root-cause investigation and live-deployment runbook for restoring `users` root fields after schema migration |
| [SafeTrust Schema Migration Architecture](history/safetrust-schema-migration.md) | *(Historical)* Completed one-time migration architecture, deployment sequence, and rollback procedures for moving `public` to `safetrust` |

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
