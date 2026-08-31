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

    BEFORE -->|ALTER TABLE\nSET SCHEMA| AFTER
```

## Four reasons for schema separation

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
    FIX --> R2[✅ RLS scoped to\nsafetrust.* only]
    FIX --> R3[✅ No custom_name\ntable names are unique]
    FIX --> R4[✅ Hasura tracks\nsafetrust.* not public.*]
```

## Three-layer escrow hierarchy after migration

```mermaid
flowchart TD
    TWE[safetrust.trustless_work_escrows\nBlockchain mirror]
    EM[safetrust.escrow_milestones\nRelease schedule]
    ET[safetrust.escrow_transactions\nBusiness log]
    U[safetrust.users]
    AP[safetrust.apartments]
    R[safetrust.reservations]
    HH[hotel_industry.hotels]
    HR[hotel_industry.reservations]
    HE[hotel_industry.escrow_transactions]

    R -->|reservation_id FK| TWE
    TWE -->|contract_id FK| EM
    TWE -->|contract_id FK| ET
    U -->|user_id FK| AP
    AP -->|apartment_id FK| R
    HR -->|escrow_id FK| HE
```

## Deployment sequence

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

```mermaid
flowchart TD
    A([Rollback triggered]) --> B[hasura migrate apply\n--version 1779300000001\n--type down]
    B --> C[ALTER TABLE safetrust.*\nSET SCHEMA public]
    C --> D[hasura metadata apply\nre-tracks public.*]
    D --> E[GraphQL smoke test\npublic schema verified]
    E --> F([✅ Rollback complete])

    style F color:#00aa00
```

### Rollback commands

```bash
# Step 1 — Revert migration
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --version 1779300000001 \
  --type down

# Step 2 — Restore previous metadata
hasura metadata apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

## What was NOT changed

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

| Item | Status |
|---|---|
| Existing migration files | ✅ Unchanged |
| Data in tables | ✅ Preserved — `ALTER TABLE SET SCHEMA` is non-destructive |
| GraphQL field names | ✅ Identical after Hasura re-tracks under `safetrust.*` |
| Migration sequence | ✅ Preserved |
| Application code | ✅ No changes required |

## Hasura metadata YAML changes

After this migration all table YAML files in `metadata/tenants/safetrust/databases/tables/` must reference `schema: safetrust` instead of `schema: public`:

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

The YAML filenames do NOT change — only the schema field inside.
