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
    FE -->|unsigned XDR| FW
    FW -->|signed XDR| FE
    FE -->|create and submit XDR| TW
    TW -->|HMAC-signed webhook callbacks| WH
    WH --> RC
    WH --> HG
    TW -->|submit transaction| SC
    SC --> USDC
    HG --> PG
    PG --> ST
    PG --> HI
```

## Frontend-managed XDR submission

Every escrow operation on Stellar requires two steps:

1. **Frontend receives an unsigned XDR** — the frontend calls TrustlessWork,
   which builds the Soroban transaction but does not sign it
2. **Frontend signs with Freighter** — the guest or host wallet
   signs the XDR locally, then the frontend submits it directly to
   TrustlessWork via `/helper/send-transaction`

SafeTrust's backend does not create, sign, or submit XDR, and it does not
expose `/api/escrows/send-transaction`. It receives the resulting escrow state
through separate HMAC-signed TrustlessWork webhook callbacks. This means
SafeTrust never holds private keys; the platform is non-custodial by design.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant TW as TrustlessWork API
    participant FW as Freighter Wallet
    participant SC as Soroban Contract

    FE->>TW: POST /escrow/single-release/initialize-escrow
    TW-->>FE: { unsignedXDR: "AAAA..." }

    FE->>FW: signTransaction(unsignedXDR)
    FW-->>FE: { signedXDR: "BBBB..." }

    FE->>TW: POST /helper/send-transaction (signedXDR)
    TW->>SC: submit to Stellar network
    SC-->>TW: { contractId: "CAZT..." }
    TW-->>FE: { contractId: "CAZT..." }
```

```mermaid
sequenceDiagram
    participant TW as TrustlessWork API
    participant WH as Webhook Backend
    participant HG as Hasura GraphQL
    participant PG as PostgreSQL

    TW->>WH: POST /api/escrows/* (HMAC-signed callback)
    WH->>WH: Verify signature and timestamp
    WH->>HG: Persist escrow state / booking updates
    HG->>PG: Execute mutation
    PG-->>HG: Updated records
    HG-->>WH: Success
    WH-->>TW: 200 { received: true }
```

## Request flow for a booking

```mermaid
flowchart TD
    A([Guest clicks Book]) --> B[Frontend starts escrow]
    B --> C[Frontend calls TrustlessWork\nPOST /escrow/single-release/initialize-escrow]
    C --> D[TrustlessWork returns\nunsigned XDR]
    D --> F[Frontend passes XDR\nto Freighter wallet]
    F --> G[Freighter signs\nguest approves in browser]
    G --> H[Frontend calls TrustlessWork\nPOST /helper/send-transaction]
    H --> J([Soroban contract deployed\nUSDC locked])

    style J color:#00aa00
```

After TrustlessWork processes the transaction, it sends an HMAC-signed callback
to the webhook backend. The backend verifies the callback and mirrors the
escrow and booking state through Hasura; it never receives or submits XDR.

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
