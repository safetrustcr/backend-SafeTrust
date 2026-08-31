# 🛡️ SafeTrust Schema Migration Architecture

This document provides a comprehensive technical breakdown of the schema migration from PostgreSQL `public` to the dedicated `safetrust` schema namespace, detailing the architecture, tenant isolation benefits, escrow hierarchy, deployment sequence, and rollback procedures.

---

## 📖 Table of Contents

- [Overview](#overview)
- [Before & After Schema Namespace](#before--after-schema-namespace)
- [Why Schema Separation Matters](#why-schema-separation-matters)
- [Three-Layer Escrow Hierarchy](#three-layer-escrow-hierarchy)
- [Non-Destructive Migration Mechanism](#non-destructive-migration-mechanism)
- [Hasura Metadata YAML Configuration](#hasura-metadata-yaml-configuration)
- [Security & Access Control Architecture](#security--access-control-architecture)
- [Elimination of GraphQL Custom Name Workarounds](#elimination-of-graphql-custom-name-workarounds)
- [Deployment Sequence](#deployment-sequence)
- [Deployment Commands](#deployment-commands)
- [Rollback Strategy](#rollback-strategy)
- [Rollback Commands](#rollback-commands)
- [Summary of Preserved Components](#summary-of-preserved-components)

---

<a id="overview"></a>
## 🔍 Overview

All SafeTrust database objects (tables, relations, sequences, and stored procedures) were initially created inside PostgreSQL's default `public` schema. As the backend expanded into a multi-tenant platform supporting multiple business domains (such as `safetrust` and `hotel_industry`), segregating database entities into dedicated schema namespaces became essential.

Migration `1779300000001_migrate_to_safetrust_schema` transitions all SafeTrust tables and signature-qualified stored functions from `public` to `safetrust` atomically and non-destructively.

---

<a id="before--after-schema-namespace"></a>
## 🏛️ Before & After Schema Namespace

Prior to the migration, all tenant entities coexisted within the `public` schema, causing namespace competition. After the migration, each tenant operates in its own isolated schema namespace (`safetrust` and `hotel_industry`).

```mermaid
flowchart LR
    subgraph BEFORE
        PUB[public schema]
        PUB --> A1[public.users]
        PUB --> A2[public.apartments]
        PUB --> A3[public.trustless_work_escrows]
        PUB --> A4[public.escrow_milestones]
        PUB --> A5[public.reservations]
        PUB --> A6[public.roles]
        PUB --> A7[...17 more tables]
    end
    subgraph AFTER
        ST[safetrust schema]
        HI[hotel_industry schema]
        ST --> B1[safetrust.users]
        ST --> B2[safetrust.apartments]
        ST --> B3[safetrust.trustless_work_escrows]
        ST --> B4[safetrust.escrow_milestones]
        ST --> B5[safetrust.reservations]
        HI --> C1[hotel_industry.hotels]
        HI --> C2[hotel_industry.rooms]
        HI --> C3[hotel_industry.reservations]
    end
    BEFORE -->|ALTER TABLE\nSET SCHEMA| AFTER
```

---

<a id="why-schema-separation-matters"></a>
## 🎯 Why Schema Separation Matters

Moving from a shared `public` schema to dedicated tenant schemas resolves four primary architectural bottlenecks:

1. **Database-Level Tenant Isolation**: Enforces clean boundaries between distinct product domains.
2. **Elimination of GraphQL Name Collisions**: Avoids conflicting root query and mutation fields.
3. **Scoped Row-Level Security (RLS) Foundation**: Provides an isolated schema namespace for configuring table-specific RLS policies.
4. **Fine-Grained Privilege Management**: Enables precise PostgreSQL `GRANT USAGE ON SCHEMA` permissions for runtime roles.

```mermaid
flowchart TD
    OLD[public.* mixed schema]
    OLD --> P1[❌ Tenant isolation\nimpossible at DB level]
    OLD --> P2[❌ GraphQL collisions\ncustom_name workarounds]
    OLD --> P3[❌ RLS cannot be scoped\nto a single tenant]
    OLD --> P4[❌ GRANT USAGE\nall-or-nothing access]
    P1 --> FIX[safetrust.* schema]
    P2 --> FIX
    P3 --> FIX
    P4 --> FIX
    FIX --> R1[✅ GRANT USAGE ON SCHEMA\nfine-grained access control]
    FIX --> R2[✅ Scoped foundation for\nsafetrust.* table RLS]
    FIX --> R3[✅ No custom_name\ntable names are unique]
    FIX --> R4[✅ Hasura tracks\nsafetrust.* not public.*]
```

> [!NOTE]
> **RLS vs. Schema Isolation**: Schema separation provides namespace boundary isolation via `GRANT USAGE ON SCHEMA`. Row-Level Security (RLS) is an orthogonal, table-level feature: it requires enabling RLS per table (`ALTER TABLE safetrust.<table_name> ENABLE ROW LEVEL SECURITY`) and defining granular rules (`CREATE POLICY ... ON safetrust.<table_name>`). The schema migration establishes the isolated namespace foundation, allowing RLS policies to be scoped cleanly to `safetrust.*` tables without cross-tenant side effects.

---

<a id="three-layer-escrow-hierarchy"></a>
## 🔐 Three-Layer Escrow Hierarchy

SafeTrust models on-chain Stellar smart contracts and rental operations through a three-layer escrow hierarchy. This structure decouples the on-chain contract state from the milestone schedule and transactional audit logs, while establishing clear foreign key relationships with users, apartments, and reservations.

```mermaid
flowchart TD
    TWE[safetrust.trustless_work_escrows\nBlockchain mirror]
    EM[safetrust.escrow_milestones\nRelease schedule]
    ET[safetrust.escrow_transactions\nBusiness log]
    U[safetrust.users]
    AP[safetrust.apartments]
    R[safetrust.reservations]
    HR[hotel_industry.reservations]
    HE[hotel_industry.escrow_transactions]
    R -->|escrow_id FK| TWE
    EM -->|escrow_id FK| TWE
    ET -.->|contract_id ref| TWE
    U -->|user_id FK| AP
    AP -->|apartment_id FK| R
    HR -->|escrow_id FK| HE
```

### Hierarchy & Foreign Key Breakdown:

1. **Blockchain Mirror Layer (`safetrust.trustless_work_escrows`)**:
   Reflects the live state of TrustlessWork Stellar escrow contracts, storing contract IDs, engagement status, client/service provider public keys, and deposit balances.
2. **Release Schedule Layer (`safetrust.escrow_milestones`)**:
   Tracks programmatic milestone releases, approval flags, and payout distributions.
   - `escrow_milestones.escrow_id` contains a database foreign key constraint referencing `safetrust.trustless_work_escrows.id` (`ON DELETE CASCADE`).
3. **Business Log Layer (`safetrust.escrow_transactions`)**:
   Maintains immutable transactional ledger entries for all deposit, release, dispute, and refund events.
   - `escrow_transactions.contract_id` records the Stellar contract ID matching `safetrust.trustless_work_escrows.contract_id` as an on-chain ledger reference (application-level identifier, not a database FK constraint).
4. **Domain Relationships**:
   - `safetrust.users.id` is referenced by `safetrust.apartments.user_id` (`user_id FK`).
   - `safetrust.apartments.id` is referenced by `safetrust.reservations.apartment_id` (`apartment_id FK`).
   - `safetrust.reservations.escrow_id` is a database foreign key referencing `safetrust.trustless_work_escrows.id` (`ON DELETE SET NULL`). Note that application booking identifiers (such as `booking_id`) are domain IDs, not foreign keys.
   - `hotel_industry.reservations.escrow_id` is an FK referencing `hotel_industry.escrow_transactions.id` within the `hotel_industry` schema.

---

<a id="non-destructive-migration-mechanism"></a>
## ⚙️ Non-Destructive Migration Mechanism

The migration executes using standard PostgreSQL `ALTER TABLE ... SET SCHEMA` and signature-qualified `ALTER FUNCTION ... SET SCHEMA` commands.

### Table Transitions
All 20 SafeTrust tables are moved between schemas:
- Core tables: `users`, `user_wallets`, `roles`, `user_roles`, `trustless_work_escrows`, `trustless_work_webhook_events`, `escrow_milestones`, `escrow_transactions`, `apartments`, `apartment_images`, `reservations`, `bid_requests`, `pricing_rules`, `pricing_overrides`, `conversations`, `messages`.
- Analytics & helper tables (using `IF EXISTS`): `bid_status_histories`, `escrow_pending_approvals`, `escrow_analytics_by_day`, `escrow_status_summary`.

### Function Relocations
The migration moves six stored procedures between schemas using explicit signature qualifications in both `up.sql` and `down.sql`:

```sql
-- Migration up (public -> safetrust)
ALTER FUNCTION IF EXISTS public.find_nearby_apartments(double precision, double precision, double precision) SET SCHEMA safetrust;
ALTER FUNCTION IF EXISTS public.find_apartments_by_owner(uuid) SET SCHEMA safetrust;
ALTER FUNCTION IF EXISTS public.search_apartments(text, text, numeric, numeric, text) SET SCHEMA safetrust;
ALTER FUNCTION IF EXISTS public.get_apartments_in_bounds(double precision, double precision, double precision, double precision) SET SCHEMA safetrust;
ALTER FUNCTION IF EXISTS public.get_escrow_analytics_by_day(date, date) SET SCHEMA safetrust;
ALTER FUNCTION IF EXISTS public.get_escrow_status_summary() SET SCHEMA safetrust;

-- Migration down (safetrust -> public)
ALTER FUNCTION IF EXISTS safetrust.find_nearby_apartments(double precision, double precision, double precision) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.find_apartments_by_owner(uuid) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.search_apartments(text, text, numeric, numeric, text) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.get_apartments_in_bounds(double precision, double precision, double precision, double precision) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.get_escrow_analytics_by_day(date, date) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.get_escrow_status_summary() SET SCHEMA public;
```

### Physical Storage & Locking Characteristics:
- **Catalog-Only Modification**: In PostgreSQL, altering an object's schema simply updates the namespace OID (`pg_class.relnamespace` for tables, `pg_proc.pronamespace` for functions) in the system catalog metadata.
- **Zero Disk Rewrites**: No heap files, data blocks, indexes, sequences, or constraints are moved, modified, or rewritten on physical disk storage.
- **Integrity Preservation**: All primary keys, foreign keys, unique constraints, check constraints, default expressions, triggers, and secondary indexes remain completely valid and intact.
- **Locking Considerations (`ACCESS EXCLUSIVE`)**: `ALTER TABLE ... SET SCHEMA` acquires an `ACCESS EXCLUSIVE` lock on each table being relocated. This lock conflicts with all other lock modes (including read queries via `ACCESS SHARE`). While the catalog update completes in milliseconds within a single transaction, it will queue behind active long-running queries and will temporarily block concurrent reads and writes during execution. Deployments should be scheduled during low-traffic maintenance windows.

---

<a id="hasura-metadata-yaml-configuration"></a>
## 📄 Hasura Metadata YAML Configuration

When tables transition schemas in PostgreSQL, Hasura requires updated metadata configuration so it tracks the tables under their new schema namespace.

### YAML Schema Definition Change

Each tracked table's metadata file updates its `table.schema` property from `public` to `safetrust`:

```yaml
# Before migration
table:
  name: users
  schema: public  # ← old

# After migration
table:
  name: users
  schema: safetrust  # ← new
```

### What YAML Filenames Change vs. What Stays the Same:
- **Table Definition Filenames (Unchanged)**:
  - Table-definition files (e.g. `metadata/tenants/safetrust/databases/tables/public_trustless_work_escrows.yaml`, `public_users.yaml`, etc.) retain their canonical file names in the repository to maintain stable file paths and ensure backward-compatible includes in `tables.yaml`.
  - The internal content of each file updates its `table.schema` field from `public` to `safetrust`.
- **Index and Build Paths**:
  - `metadata/tenants/safetrust/databases/tables/tables.yaml` continues to include the YAML files via `!include public_<table_name>.yaml`.
  - During deployment, `metadata/build-metadata.sh` merges tenant configurations into `metadata/build/safetrust/databases/databases.yaml`, producing the final metadata payload that Hasura applies to track `safetrust.<table_name>`.
- **Relationships & Permissions (Preserved)**:
  - Relationship names (`object_relationships` and `array_relationships`) retain identical names and join fields.
  - Permission rules (`select_permissions`, `insert_permissions`, `update_permissions`, `delete_permissions`) and filter definitions remain unchanged.
  - Custom column descriptions and comment annotations are preserved.

---

<a id="security--access-control-architecture"></a>
## 🛡️ Security & Access Control Architecture

In standard PostgreSQL deployments, the `public` schema has default permissions that allow all roles to connect and create objects unless aggressively restricted.

### Role Separation & Least Privilege

Production database access enforces a strict separation between migration roles and runtime application roles:

- **Migration Role (`safetrust_admin`)**: Used by Hasura CLI and migration runners with DDL privileges to create schemas, alter tables, and manage metadata.
- **Runtime Application Role (`safetrust_user`)**: Used by Hasura GraphQL Engine and webhook services, granted least-privilege DML permissions restricted exclusively to the `safetrust` schema.

```sql
-- 1. Schema-Level Access for Runtime Role
GRANT USAGE ON SCHEMA safetrust TO safetrust_user;

-- 2. Granular Table and Sequence Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA safetrust TO safetrust_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA safetrust TO safetrust_user;

-- 3. Deterministic Default Privileges for Future Migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO safetrust_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust
  GRANT USAGE, SELECT ON SEQUENCES TO safetrust_user;
```

### Multi-Tenant Protection:
Because `safetrust_user` is granted `USAGE` strictly on `SCHEMA safetrust`, it has zero visibility into `hotel_industry` or other tenant schemas. Even if a runtime service were compromised, cross-tenant data queries are rejected at the PostgreSQL permission layer.

*(Note: In local Docker development environments, the `postgres` superuser is used for unified container initialization, whereas production environments enforce the distinct `safetrust_admin` and `safetrust_user` role boundaries above).*

---

<a id="elimination-of-graphql-custom-name-workarounds"></a>
## 🚫 Elimination of GraphQL Custom Name Workarounds

In a unified or multi-tenant GraphQL API where tables share the `public` schema, identical table names (e.g., `reservations` in SafeTrust vs `reservations` in Hotel Industry) result in field name collisions in the auto-generated GraphQL schema.

### Prior Workarounds vs Schema Namespacing:
- **Prior Workaround**: Developers had to manually configure `custom_name` or `custom_root_fields` in Hasura metadata for every colliding entity (e.g., aliasing `public.reservations` to `safetrust_reservations`).
- **Post-Migration Solution**: By segregating tables into `safetrust` and `hotel_industry` database sources or schemas, Hasura natively disambiguates root fields and relationship trees without requiring manual `custom_name` overrides.

---

<a id="deployment-sequence"></a>
## 🚀 Deployment Sequence

The deployment workflow applies the schema migration, updates Hasura metadata tracking, and executes a GraphQL verification smoke test with defined error paths.

```mermaid
flowchart TD
    A([Start]) --> B[hasura migrate apply\n--version 1779300000001\n--type up]
    B --> C{Applied?}
    C -- Yes --> D[hasura metadata apply\nre-tracks safetrust.*]
    C -- No --> E1[❌ Check migration logs\nVerify Hasura connectivity]
    D --> F{Metadata OK?}
    F -- Yes --> G[GraphQL smoke test\nsafetrust_reservations limit 1]
    F -- No --> E2[❌ Check YAML files\nVerify schema: safetrust]
    G --> H{Returns data?}
    H -- Yes --> OK([✅ Migration complete])
    H -- No --> E3[❌ Check Hasura tracking\nVerify re-track ran]
    style OK color:#00aa00
    style E1 color:#cc0000
    style E2 color:#cc0000
    style E3 color:#cc0000
```

---

<a id="deployment-commands"></a>
## 💻 Deployment Commands

Execute the following sequential commands during migration deployment:

```bash
# Step 1 — Apply database migration
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --version 1779300000001 \
  --type up

# Step 2 — Reload Hasura metadata
hasura metadata apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey

# Step 3 — GraphQL smoke test
curl -X POST http://localhost:8080/v1/graphql \
  -H "x-hasura-admin-secret: myadminsecretkey" \
  -H "Content-Type: application/json" \
  -d '{"query": "query { safetrust_reservations(limit: 1) { id } }"}'
```

---

<a id="rollback-strategy"></a>
## 🔄 Rollback Strategy

If issues occur during or after migration deployment, the rollback flow reverts the schema back to `public` and re-applies previous Hasura metadata tracking.

```mermaid
flowchart TD
    A([Rollback triggered]) --> B[hasura migrate apply\n--version 1779300000001\n--type down]
    B --> C[ALTER TABLE safetrust.*\nSET SCHEMA public]
    C --> D[hasura metadata apply\nre-tracks public.*]
    D --> E[GraphQL smoke test\npublic schema verified]
    E --> F([✅ Rollback complete])
    style F color:#00aa00
```

---

<a id="rollback-commands"></a>
## ⏪ Rollback Commands

Execute the following commands to safely revert the migration and restore metadata tracking:

```bash
# Step 1 — Revert migration
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --version 1779300000001 \
  --type down

# Step 2 — Restore previous metadata
# Revert metadata YAML files to public.* schema references
# then apply:
hasura metadata apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

---

<a id="summary-of-preserved-components"></a>
## ✅ Summary of Preserved Components

The schema namespace migration non-destructively reorganizes catalog metadata while preserving application integrity.

```mermaid
flowchart LR
    subgraph Unchanged
        A[✅ Migration sequence\npreserved exactly]
        B[✅ All data preserved\nALTER TABLE non-destructive]
        C[✅ GraphQL field names\nidentical after re-track]
        D[✅ No existing SQL\nfiles modified]
        E[✅ API surface\nno code changes needed]
    end
```

- **Migration Sequence**: Preserved exactly in timestamp order.
- **Data Integrity**: 100% data retention across all rows, tables, constraints, and sequences.
- **API Surface**: Zero breaking changes to client GraphQL queries and mutations.
- **SQL Scripts**: Historical migration SQL files remain untouched.
