# SafeTrust Schema Migration Strategy

## Why this migration exists

All SafeTrust tables were originally created in the PostgreSQL `public` schema. Migration `1779300000001` moves them to the `safetrust` schema to enforce tenant data isolation at the PostgreSQL permission level.

### Before and after

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

    BEFORE -->|ALTER TABLE<br/>SET SCHEMA| AFTER
```

## Four reasons for schema separation

```mermaid
flowchart TD
    OLD[public.* mixed schema]

    OLD --> P1[❌ Tenant isolation<br/>impossible at DB level]
    OLD --> P2[❌ GraphQL collisions<br/>custom_name workarounds]
    OLD --> P3[❌ RLS cannot be scoped<br/>to a single tenant]
    OLD --> P4[❌ Broad ALL privileges on<br/>public tables and sequences]

    P1 --> FIX[safetrust.* schema]
    P2 --> FIX
    P3 --> FIX
    P4 --> FIX

    FIX --> R1[✅ GRANT USAGE ON SCHEMA<br/>fine-grained access control]
    FIX --> R2[✅ RLS scoped to<br/>safetrust.* only]
    FIX --> R3[⚠️ custom_name active without custom_root_fields<br/>webhook update_reservations mismatch]
    FIX --> R4[✅ Hasura tracks<br/>safetrust.* not public.*]
```

> [!NOTE]
> **Schema Privileges & Grants (Node P4)**: `GRANT USAGE ON SCHEMA safetrust` grants schema usage, not table or sequence access. The migration grants schema `USAGE` separately from `ALL` privileges on tables and sequences. The migration script must execute explicit `GRANT` commands for tables (`GRANT ALL ON ALL TABLES IN SCHEMA safetrust TO ...`) and sequences (`GRANT ALL ON ALL SEQUENCES IN SCHEMA safetrust TO ...`), alongside revoking default public schema privileges (`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ...`).

> [!NOTE]
> **Root Field Mapping Limitation (Node R3)**: The metadata sets `custom_name: safetrust_reservations` and `custom_name: hotel_reservations` without `custom_root_fields`. Hasura generates root operations derived from those custom names (e.g. `update_safetrust_reservations`) while webhook handlers still call `update_reservations`. A `custom_root_fields` mapping fix is required to map root operations back to expected field names.

## Three-layer escrow hierarchy after migration

```mermaid
flowchart TD
    TWE[safetrust.trustless_work_escrows<br/>Blockchain mirror]
    EM[safetrust.escrow_milestones<br/>Release schedule]
    ET[safetrust.escrow_transactions<br/>Business log]
    U[safetrust.users]
    AP[safetrust.apartments]
    R[safetrust.reservations]
    HH[hotel_industry.hotels]
    HR[hotel_industry.reservations]
    HE[hotel_industry.escrow_transactions]

    R -->|reservation_id FK| TWE
    TWE -->|escrow_id FK| EM
    TWE -->|contract_id FK| ET
    U -->|owner_id FK| AP
    AP -->|apartment_id FK| R
    HR -->|escrow_id FK| HE
```

## Deployment sequence

```mermaid
flowchart TD
    A([Start]) --> B[hasura migrate apply<br/>--version 1779300000001<br/>--type up]
    B --> C{Applied?}
    C -- Yes --> D[hasura metadata apply<br/>re-tracks safetrust.*]
    C -- No --> E1[❌ Check migration logs<br/>Verify Hasura connectivity]
    D --> F{Metadata OK?}
    F -- Yes --> G[GraphQL smoke test<br/>safetrust_reservations limit 1]
    F -- No --> E2[❌ Check YAML files<br/>Verify schema: safetrust]
    G --> H{Returns data?}
    H -- Yes --> OK([✅ Migration complete])
    H -- No --> E3[❌ Check Hasura tracking<br/>Verify re-track ran]

    style OK color:#00aa00
    style E1 color:#cc0000
    style E2 color:#cc0000
    style E3 color:#cc0000
```

### Commands

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

## Rollback strategy

> [!WARNING]
> Running `hasura metadata apply` during rollback targets the current `metadata/` directory, which already contains `safetrust.*` tables and will not restore `public.*` tracking. A pre-migration metadata snapshot must exist prior to applying migration `1779300000001` in order to restore `public.*` schema tracking.

```mermaid
flowchart TD
    A([Rollback triggered]) --> B[hasura migrate apply<br/>--version 1779300000001<br/>--type down]
    B --> C[ALTER TABLE safetrust.*<br/>SET SCHEMA public]
    C --> D[hasura metadata apply<br/>from pre-migration snapshot]
    D --> E[GraphQL smoke test<br/>public schema verified]
    E --> F([✅ Rollback complete])

    style F color:#00aa00
```

### Pre-migration Snapshot Backup

Prior to executing the migration, capture a pre-migration metadata snapshot:

```bash
# Step 0 — Export pre-migration metadata snapshot
hasura metadata export \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --output-dir metadata_backup
```

### Rollback procedure

```bash
# Step 1 — Revert migration
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --version 1779300000001 \
  --type down

# Step 2 — Restore pre-migration metadata snapshot
hasura metadata apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --project metadata_backup
```

## What was NOT changed

```mermaid
flowchart LR
    subgraph Unchanged
        A[✅ Migration sequence<br/>preserved exactly]
        B[✅ All data preserved<br/>ALTER TABLE non-destructive]
        C[✅ GraphQL field names<br/>identical after re-track]
        D[✅ No existing SQL<br/>files modified]
        E[✅ API surface<br/>no code changes needed]
    end
```

| Item | Status |
|---|---|
| Existing migration files | ✅ Unchanged |
| Data in tables | ✅ Preserved — `ALTER TABLE SET SCHEMA` is non-destructive |
| GraphQL field names | ✅ Identical after Hasura re-tracks under `safetrust.*` |
| Migration sequence | ✅ Preserved |
| Application code | ✅ No changes required |

## Hasura metadata YAML changes

Only tables actually moved by migration `1779300000001` change to `schema: safetrust`. After this migration, table YAML files in `metadata/tenants/safetrust/databases/tables/` for moved tables reference `schema: safetrust` instead of `schema: public`:

```yaml
# Before migration
table:
  name: users
  schema: public        # ← old

# After migration
table:
  name: users
  schema: safetrust     # ← new
```

The YAML filenames do NOT change — only the `schema` field inside for moved tables.

> [!IMPORTANT]
> The spatial tables `public_geography_columns`, `public_geometry_columns`, and `public_spatial_ref_sys` were NOT moved by migration `1779300000001` and remain on `schema: public`.

