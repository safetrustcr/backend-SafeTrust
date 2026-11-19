# 📚 SafeTrust Backend Documentation

Reference documentation for the **SafeTrust** backend — Hasura GraphQL, PostgreSQL, the multi-tenant engine, smart contract escrow lifecycle, and operational tooling.

For setup and day-to-day commands, start with the [root README](../README.md).

---

## 📖 Quick Links & Index

### 🏗️ Architecture
| Document | Description |
|---|---|
| [Architecture Overview](architecture/overview.md) | System layers, the frontend-managed XDR flow, and webhook callbacks |
| [Multi-Tenant Architecture](architecture/multi-tenant.md) | Two-tenant isolation model (`safetrust` and `hotel_industry`), schema routing, and RBAC rules |
| [Rust Crates in SafeTrust](architecture/rust-crates.md) | High-assurance native extensions via Neon bindings for cryptography and blockchain operations |
| [Crate Boundaries](architecture/crate-boundaries.md) | Consumers, exports, fallbacks, dispositions, and quarantine gates for all eight Rust crates |
| [Escrow Claims API](architecture/escrow-claims-api.md) | Request and response contract, error codes, idempotency and rate limit for claims on released escrows |
| [Reservations API](architecture/reservations-api.md) | Lifecycle, allowed actions computation, read endpoints, and safe cancellation protocol |
| [Wallet Registry API](architecture/wallets-api.md) | Verified wallet management lifecycle (list, unlink, and atomic set-primary endpoints) |
| [Hotel Conversation Notifications](architecture/hotel-conversation-notifications.md) | In-process lifecycle notifications, time budget, idempotent conversation creation, and removal of the internal secret |
| [Error Handling, Logging and CORS](architecture/error-handling-and-logging.md) | Typed `AppError` mapping, sanitized 5xx bodies, structured logs with `requestId`, raw-body capture, and the CORS origin policy |

### 📜 Architecture Decision Records (ADRs)
| Document | Description |
|---|---|
| [ADR-0001: ZK Eligibility Statement and Trust Model](adr/0001-zk-eligibility-statement-and-trust-model.md) | *(Superseded by #753)* Predicate specification, trust boundaries, feasibility trade-offs, and verification key pinning for escrow admission |

### 🔐 Stellar & Escrow Flows
| Document | Description |
|---|---|
| [Escrow Lifecycle](stellar/escrow-lifecycle.md) | Full TrustlessWork Stellar smart contract escrow state machine and transitions |
| [Fund Escrow](stellar/fund-escrow.md) | Workflow and validation sequence for funding guest reservation escrows |
| [Approve Milestone](stellar/approve-milestone.md) | Milestone verification and approval lifecycle for escrow funds |
| [Release Funds](stellar/release-funds.md) | Payout release mechanisms and on-chain settlement execution |
| [Dispute & Resolve](stellar/dispute-resolve.md) | Two-phase XDR dispute lifecycle, Soroban roles, status transitions, and indexer synchronization |
| [Escrow State Source](stellar/escrow-state-source.md) | Authoritative state source selection, removal of fabricated reads, and adapter validation |
| [Trustless Work Indexer Sync](stellar/trustless-work-indexer.md) | How reconciliation reads the Trustless Work V1 indexer: configuration, request, status derivation from flags, field mapping, and the unversioned-snapshot limitation |
| [x402 Protocol](stellar/x402-protocol.md) | Agentic payments on Stellar using Soroban authorization entries and USDC SEP-41 |


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
