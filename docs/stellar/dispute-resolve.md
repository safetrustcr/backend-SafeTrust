# Dispute and Resolve Dispute

Dispute resolution is a two-step process. Any party to the
escrow can open a dispute — only the designated resolver
(SafeTrust platform wallet) can resolve it.

## Open dispute flow

```mermaid
flowchart LR
    A([POST\n/api/escrows/dispute]) --> B["Body:\n{\n  contractId: 'CAZ6UQX7...'\n  disputer: 'GGUEST1234...'\n}"]
    B --> C{Valid?}
    C -- Yes --> D["Escrow status → disputed\nFunds remain locked\nResolver notified"]
    C -- No --> E["Errors:\n1. Not in funded or active state\n2. Disputer is not a party\n3. Contract not found"]

    style D color:#00aa00
    style E color:#cc0000
```

## Resolve dispute flow

```mermaid
flowchart LR
    A([POST\n/api/escrows/resolve-dispute]) --> B["Body:\n{\n  contractId: 'CAZ6UQX7...'\n  resolver: 'GRESOLVER...'\n  approverAmount: '7'\n  markerAmount: '3'\n}"]
    B --> C{Valid?}
    C -- Yes --> D["USDC split on-chain:\nguest ← 7 USDC\nhost ← 3 USDC\nStatus → resolved"]
    C -- No --> E["Errors:\n1. Not in disputed state\n2. Only resolver can resolve\n3. Amounts must sum to escrow total\n4. Contract not found"]

    style D color:#00aa00
    style E color:#cc0000
```

## Role responsibilities

```mermaid
flowchart TD
    subgraph Escrow Parties
        G[Guest\napprover wallet\ncan open dispute]
        H[Host\nmarker wallet\ncan open dispute]
    end

    subgraph Neutral Party
        R[SafeTrust Platform\nresolver wallet\nonly party that can resolve]
    end

    subgraph Soroban Contract
        SC[Funds locked\nthroughout dispute\nreleased only on resolve]
    end

    G -->|POST /api/escrows/dispute| SC
    H -->|POST /api/escrows/dispute| SC
    R -->|POST /api/escrows/resolve-dispute\napproverAmount + markerAmount| SC
    SC -->|approverAmount| G
    SC -->|markerAmount| H
```

## Amount constraint

`approverAmount + markerAmount` must equal the original
escrow deposit exactly. The Soroban contract enforces this
on-chain — if amounts do not sum to the escrow total the
transaction is rejected before any USDC moves.

```
Example escrow: 10 USDC total

Valid:
  approverAmount: "7"  → guest receives 7 USDC
  markerAmount:   "3"  → host receives 3 USDC
  7 + 3 = 10 ✅

Invalid:
  approverAmount: "7"
  markerAmount:   "2"
  7 + 2 = 9 ≠ 10 ❌ → transaction rejected
```

## Why funds remain locked during dispute

Funds are held inside the Soroban smart contract — not
in SafeTrust's database or any centralized wallet. Once
a dispute is opened the contract prevents any release or
cancellation path from executing. Only the `resolve-dispute`
operation signed by the resolver wallet can move USDC out
of the contract. SafeTrust has no ability to unlock funds
unilaterally — this is by design.

## State machine context

```mermaid
stateDiagram-v2
    funded --> disputed : POST /api/escrows/dispute
    active --> disputed : POST /api/escrows/dispute
    disputed --> resolved : POST /api/escrows/resolve-dispute\nresolver splits USDC
```

## Phase 3 — Human-in-loop AI approval

In Phase 3, SafeTrust will introduce human-in-loop approval
workflows for high-value disputes. An AI agent will analyze
the dispute context (booking metadata, milestone history,
conversation logs) and propose a split. A human reviewer
approves or adjusts before the resolver wallet signs.
The Soroban contract interface is unchanged — only the
decision process before signing.