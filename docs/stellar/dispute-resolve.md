# Dispute Resolution

SafeTrust supports a formal dispute flow for escrow contracts. Either party can raise a dispute, and a designated resolver splits the locked USDC between the guest and host.

## Open a Dispute

```mermaid
flowchart LR
    A([POST\n/api/escrows/dispute]) --> B["Body:\n{\n  contractId: 'CAZ6UQX7...'\n  disputer: 'GGUEST1234...'\n}"]
    B --> C{Valid?}
    C -- Yes --> D["Escrow status → disputed\nFunds remain locked\nResolver notified"]
    C -- No --> E["Errors:\n1. Not in funded or active state\n2. Disputer is not a party\n3. Contract not found"]

    style D color:#00aa00
    style E color:#cc0000
```

### Who is the Resolver

The resolver is a SafeTrust platform wallet (`GRESOLVER...`). It is not one of the transacting parties. When a dispute is raised, the resolver is notified and is the only identity authorized to call the resolve endpoint.

### Why Funds Remain Locked

Once a contract enters the `disputed` state, the Soroban smart contract keeps the USDC locked. No party can withdraw funds until the resolver submits a split decision. This prevents either side from taking unilateral action while the dispute is being adjudicated.

## Resolve a Dispute

```mermaid
flowchart LR
    A([POST\n/api/escrows/resolve-dispute]) --> B["Body:\n{\n  contractId: 'CAZ6UQX7...'\n  resolver: 'GRESOLVER...'\n  approverAmount: '7'\n  markerAmount: '3'\n}"]
    B --> C{Valid?}
    C -- Yes --> D["USDC split on-chain:\nguest ← 7 USDC\nhost ← 3 USDC\nStatus → resolved"]
    C -- No --> E["Errors:\n1. Not in disputed state\n2. Only resolver can resolve\n3. Amounts must sum to escrow total\n4. Contract not found"]

    style D color:#00aa00
    style E color:#cc0000
```

### Amount Sum Constraint

`approverAmount + markerAmount` must equal the total escrow amount in USDC. The resolver cannot keep or add funds; the split is a zero-sum redistribution of the locked balance.

### Phase 3 Plan: Human-in-the-Loop AI Approval

Future iterations will introduce an AI-assisted review step that proposes a split recommendation to a human resolver before the on-chain settlement is executed. The human retains final sign-off authority.
