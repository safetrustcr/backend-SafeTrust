# Dispute and Resolve Dispute

TrustlessWork reports dispute lifecycle changes to SafeTrust through
callbacks. These handlers mirror the resulting state in the
database; they do not submit Soroban transactions or decide how funds
are distributed.

## Open dispute flow

```mermaid
flowchart LR
    A([POST\n/api/escrows/dispute]) --> B["Body:\n{\n  contractId: 'CAZ6UQX7...'\n  disputeFlag: true\n  disputer: 'GGUEST1234...'\n}"]
    B --> C{Valid?}
    C -- Yes --> D["Database updates:\nEscrow status → disputed\nReservation status → disputed\nEscrow balance unchanged"]
    C -- No --> E["Errors:\n1. Missing required field\n2. disputeFlag is not true\n3. No escrow in an eligible prior state"]

    style D color:#00aa00
    style E color:#cc0000
```

## Resolve dispute flow

```mermaid
flowchart LR
    A([POST\n/api/escrows/resolve-dispute]) --> B["Body:\n{\n  contractId: 'CAZ6UQX7...'\n  resolver: 'GRESOLVER...'\n  resolutionNote: 'Optional note'\n}"]
    B --> C{Valid?}
    C -- Yes --> D["Database updates:\nEscrow status → resolved\nEscrow balance → 0\nReservation status → resolved\nOptional note → escrow metadata"]
    C -- No --> E["Errors:\n1. Missing contractId or resolver\n2. No escrow in disputed state\n3. Database update failure"]

    style D color:#00aa00
    style E color:#cc0000
```

## Callback responsibilities

```mermaid
flowchart LR
    TW[TrustlessWork] -->|dispute callback| DH[disputeEscrowHandler]
    TW -->|resolve callback| RH[resolveDisputeHandler]
    DH -->|status: disputed| ES[(trustless_work_escrows)]
    DH -->|status: disputed| RS[(reservations)]
    RH -->|status: resolved\nbalance: 0\noptional resolution note| ES
    RH -->|status: resolved| RS
```

## Settlement boundary

`POST /api/escrows/resolve-dispute` is a callback that records an
already-reported resolution. It does not accept `approverAmount` or
`markerAmount`, split USDC, or invoke TrustlessWork. No separate
disputed-escrow settlement operation is implemented in this repository.
The existing `POST /api/escrows/release-funds` callback belongs to the
normal `milestone_approved` to `completed` flow and is not a dispute
settlement endpoint.

## State machine context

```mermaid
stateDiagram-v2
    funded --> disputed : POST /api/escrows/dispute
    active --> disputed : POST /api/escrows/dispute
    milestone_approved --> disputed : POST /api/escrows/dispute
    disputed --> resolved : POST /api/escrows/resolve-dispute\nrecord callback and set balance to 0
```

## Phase 3 — Human-in-loop AI approval

In Phase 3, SafeTrust will introduce human-in-loop approval
workflows for high-value disputes. An AI agent will analyze
the dispute context (booking metadata, milestone history,
conversation logs) and propose a resolution. A human reviewer
will approve or adjust that proposal before any upstream
resolution action. The callback payload and database behavior
described above remain unchanged.
