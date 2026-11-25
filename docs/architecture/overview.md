# SafeTrust Architecture Overview

> **Status: Planned — post-Issue-03 behavior.** This page documents the
> polling-based escrow flow planned by Issue 03. The route implementation in
> this checkout has not yet been migrated to this contract.

SafeTrust connects a Next.js frontend, an Express backend, Hasura, PostgreSQL,
and the Stellar blockchain through Trustless Work. The backend is TypeScript;
the only native code left is the quarantined `x402-processor` Neon addon (see
[Rust crates in SafeTrust](./rust-crates.md)).

## System diagram

```mermaid
flowchart TD
    subgraph Client Layer
        GU([Guest Browser])
        HO([Host Browser])
        AI([AI Agent / x402])
    end

    subgraph SafeTrust Frontend
        FE[Next.js 14 dApp]
        FW[Freighter Wallet]
    end

    subgraph SafeTrust Backend
        BE[Express API\nNode.js TypeScript]
        RC[x402-processor\nNeon addon, X402_ENABLED]
        HG[Hasura GraphQL\nv2.47.0]
    end

    subgraph Data Layer
        PG[(PostgreSQL 15\nPostGIS)]
        ST[safetrust schema]
        HI[hotel_industry schema]
    end

    subgraph Stellar Network
        TW[Trustless Work API]
        SC[Soroban Smart Contract]
        USDC[USDC SEP-41]
    end

    GU --> FE
    HO --> FE
    AI -->|X-Payment header| BE
    FE -->|request unsigned XDR| BE
    BE -->|build transaction| TW
    TW -->|unsigned XDR| BE
    BE -->|unsigned XDR| FE
    FE -->|sign in wallet| FW
    FW -->|signed XDR| FE
    FE -->|/helper/send-transaction| TW
    TW -->|submit transaction| SC
    BE --> RC
    BE --> HG
    HG --> PG
    PG --> ST
    PG --> HI
    SC --> USDC
```

## Frontend-managed signing and submission

For each escrow operation, the frontend requests an unsigned XDR from the
SafeTrust operation route. SafeTrust asks Trustless Work to build the
operation-specific transaction and returns the unsigned XDR. The connected
wallet signs it locally, and the frontend submits the signed XDR through
Trustless Work's `POST /helper/send-transaction`.

SafeTrust does not hold user private keys. A build response or wallet signature
alone does not mean that an escrow state transition has completed.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BE as SafeTrust backend
    participant TW as Trustless Work API
    participant FW as Freighter wallet
    participant ST as Stellar

    FE->>BE: POST /api/escrows/{operation}
    BE->>TW: POST operation endpoint (build unsigned XDR)
    TW-->>BE: unsigned XDR
    BE-->>FE: unsigned XDR
    FE->>FW: signTransaction(unsigned XDR)
    FW-->>FE: signed XDR
    FE->>TW: POST /helper/send-transaction
    TW->>ST: submit transaction
    ST-->>TW: transaction result
```

## Reconciliation and transaction confirmation

Trustless Work has no webhooks. SafeTrust learns the state of client-submitted
escrow operations through scheduled reconciliation. The Hasura cron trigger
calls `POST /reconciliation/sync-escrows`; SafeTrust polls the V1 indexer and
reconciles escrow state from the returned flags and balance.

```mermaid
sequenceDiagram
    participant CR as Hasura cron
    participant BE as SafeTrust backend
    participant TW as Trustless Work API
    participant DB as PostgreSQL

    CR->>BE: POST /reconciliation/sync-escrows
    BE->>TW: GET /helper/get-escrow-by-contract-ids
    TW-->>BE: escrow flags, roles, and balance
    BE->>DB: reconcile escrow state
```

For transactions SafeTrust itself submits, the backend confirms the transaction
result before applying the corresponding local state change. The five wallet
flows documented here submit through Trustless Work from the frontend, so
SafeTrust learns their results through reconciliation polling. The indexer's
status and field mapping, including its snapshot-freshness limitation, is
documented in [Trustless Work Indexer](../stellar/trustless-work-indexer.md).

## Escrow route map

These are the frontend-facing SafeTrust operation routes for the planned
Issue-03 flow. Trustless Work endpoint paths are relative to its configured API
base URL; select the path that matches the escrow type.

| Operation | SafeTrust route | Trustless Work build endpoint |
|---|---|---|
| Fund | `POST /api/escrows/fund` | `POST /escrow/{single-release\|multi-release}/fund-escrow` |
| Approve milestone | `POST /api/escrows/approve-milestone` | `POST /escrow/{single-release\|multi-release}/approve-milestone` |
| Release | `POST /api/escrows/release-funds` | `POST /escrow/single-release/release-funds` or `POST /escrow/multi-release/release-milestone-funds` |
| Dispute | `POST /api/escrows/dispute` | `POST /escrow/single-release/dispute-escrow` or `POST /escrow/multi-release/dispute-milestone` |
| Resolve | `POST /api/escrows/resolve-dispute` | `POST /escrow/single-release/resolve-dispute` or `POST /escrow/multi-release/resolve-milestone-dispute` |

All five operations submit signed XDR with `POST /helper/send-transaction`.
SafeTrust then uses `GET /helper/get-escrow-by-contract-ids` during
reconciliation to learn the indexed escrow state.

## Repository structure

```mermaid
flowchart LR
    subgraph safetrustcr org
        BE[backend-SafeTrust\nExpress + Hasura]
        FE[frontend-SafeTrust\nNext.js 14 dApp]
        DA[dApp-SafeTrust\nFreighter integration]
        LA[landing-SafeTrust\nMarketing site]
        ZK[safetrust-ZK\nNoir circuits]
    end

    BE -->|GraphQL API| FE
    BE -->|GraphQL API| DA
    DA -->|wallet signing| BE
    ZK -->|cargo build| BE
```
