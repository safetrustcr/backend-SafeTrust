# SafeTrust Architecture Overview

SafeTrust connects four layers: a Next.js frontend, an Express
webhook backend, a Hasura GraphQL engine, and the Stellar
blockchain via TrustlessWork. Rust crates handle security-critical
and performance-critical work via Neon bindings.

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
        WH[Express Webhook\nNode.js TypeScript]
        RC[Rust Crates\nNeon Bindings]
        HG[Hasura GraphQL\nv2.47.0]
    end

    subgraph Data Layer
        PG[(PostgreSQL 15\nPostGIS)]
        ST[safetrust schema]
        HI[hotel_industry schema]
    end

    subgraph Stellar Network
        TW[TrustlessWork API]
        SC[Soroban Smart Contract]
        USDC[USDC SEP-41]
    end

    GU --> FE
    HO --> FE
    AI -->|X-Payment header| WH
    FE --> FW
    FE --> WH
    FW -->|sign XDR| SC
    WH --> RC
    WH --> HG
    WH --> TW
    TW --> SC
    SC --> USDC
    HG --> PG
    PG --> ST
    PG --> HI
```

## Two-phase XDR signing

Every escrow operation on Stellar requires two steps:

1. **Backend returns unsigned XDR** — SafeTrust calls TrustlessWork
   which builds the Soroban transaction but does not sign it
2. **Frontend signs with Freighter** — the guest or host wallet
   signs the XDR locally, then submits via `/helper/send-transaction`

This means SafeTrust never holds private keys.
The platform is non-custodial by design.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BE as Webhook Backend
    participant TW as TrustlessWork API
    participant FW as Freighter Wallet
    participant SC as Soroban Contract

    FE->>BE: POST /api/escrows/initialize
    BE->>TW: POST /escrow/single-release/initialize-escrow
    TW-->>BE: { unsignedXDR: "AAAA..." }
    BE-->>FE: { unsignedXDR: "AAAA..." }

    FE->>FW: signTransaction(unsignedXDR)
    FW-->>FE: { signedXDR: "BBBB..." }

    FE->>BE: POST /api/escrows/send-transaction
    BE->>TW: POST /helper/send-transaction
    TW->>SC: submit to Stellar network
    SC-->>TW: { contractId: "CAZT..." }
    TW-->>BE: { contractId: "CAZT..." }
    BE-->>FE: { contractId: "CAZT..." }
```

## Request flow for a booking

```mermaid
flowchart TD
    A([Guest clicks Book]) --> B[Frontend calls\nPOST /api/escrows/initialize]
    B --> C[Backend calls TrustlessWork\nPOST /escrow/single-release/initialize-escrow]
    C --> D[TrustlessWork returns\nunsigned XDR]
    D --> E[Backend returns\nunsigned XDR to frontend]
    E --> F[Frontend passes XDR\nto Freighter wallet]
    F --> G[Freighter signs\nguest approves in browser]
    G --> H[Frontend calls\nPOST /api/escrows/send-transaction]
    H --> I[Backend submits\nsigned XDR to Stellar]
    I --> J([Soroban contract deployed\nUSDC locked])

    style J color:#00aa00
```

## Repository structure

```mermaid
flowchart LR
    subgraph safetrustcr org
        BE[backend-SafeTrust\nExpress + Hasura + Rust]
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