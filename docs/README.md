# 📚 SafeTrust Backend Documentation

Welcome to the **SafeTrust Backend** documentation. This directory provides comprehensive architectural guides, database migration references, tenant configuration specs, and operational workflows for the SafeTrust platform.

---

## 📖 Documentation Index

### 🏗️ Core Architecture
- [Multi-Tenant Architecture](architecture/multi-tenant.md) — Two-tenant model (`safetrust` and `hotel_industry`), schema routing, metadata splitting, tenant resolution, and RBAC rules.
- [Rust Crates in SafeTrust](architecture/rust-crates.md) — High-assurance native Rust extensions via Neon bindings for cryptographic security, parallel processing, and blockchain parsing.

### 🐘 Database & Migrations
- [SafeTrust Schema Migration Architecture](migrations/safetrust-schema-migration.md) — Detailed architecture, atomic Mermaid diagrams, before/after schema namespace breakdown, deployment sequence, and rollback procedures for migration `1779300000001_migrate_to_safetrust_schema`.

### 🏢 Multi-Tenant Architecture
- **Tenant Isolation**: Separation of product domains across `safetrust` and `hotel_industry` schemas.
- **Metadata Management**: Modular Hasura metadata per tenant merged at build time via `metadata/setup-tenant.sh`.
- **RBAC & Permissions**: Role-based access control and Row-Level Security (RLS) rules configured per tenant.

### 🔐 Escrow & Blockchain Integration
- **TrustlessWork Stellar Escrows**: Smart contract lifecycle integration on Stellar.
- **Three-Layer Escrow Model**:
  - `trustless_work_escrows` (blockchain mirror)
  - `escrow_milestones` (release schedule)
  - `escrow_transactions` (business and audit logs)

### 🚀 Operations & Tooling
- **Startup Script**: `bin/start` orchestrates container setup, database health checks, source registration, migration execution, and seed data initialization.
- **Benchmarking Protocol**: `bin/deploy_init` provides sequential vs. parallel tenant deployment benchmarking.
- **Automated API Testing**: `bin/test` executes Karate API tests against containerized services.

---

## 🛠️ Quick Links

- [Root README](../README.md)
- [Git Guidelines](../GIT_GUIDELINE.md)
- [Contributors Guide](../CONTRIBUTORS_GUIDELINE.md)
