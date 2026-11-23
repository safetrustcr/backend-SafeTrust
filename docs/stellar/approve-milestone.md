# Approve Milestone

> **Status: Planned — post-Issue-03 behavior.** This is the intended
> polling-based flow; the route implementation in this checkout has not yet
> been migrated to it.

The frontend requests an unsigned milestone-approval transaction from SafeTrust.
The authorized user signs it in their wallet, Trustless Work submits it to
Stellar, and SafeTrust reads the resulting milestone flags through indexer
reconciliation.

## Sequence

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BE as SafeTrust backend
    participant TW as Trustless Work API
    participant FW as Approver wallet
    participant ST as Stellar
    participant CR as Hasura cron

    FE->>BE: POST /api/escrows/approve-milestone
    BE->>TW: POST /escrow/{type}/approve-milestone
    TW-->>BE: unsigned XDR
    BE-->>FE: unsigned XDR
    FE->>FW: sign unsigned XDR
    FW-->>FE: signed XDR
    FE->>TW: POST /helper/send-transaction
    TW->>ST: submit signed transaction
    ST-->>TW: transaction result
    CR->>BE: POST /reconciliation/sync-escrows
    BE->>TW: GET /helper/get-escrow-by-contract-ids
    TW-->>BE: milestone flags and balance
    BE->>BE: reconcile indexed state
```

## Routes and state

1. The frontend calls SafeTrust `POST /api/escrows/approve-milestone` with the
   contract and milestone details.
2. SafeTrust requests an unsigned XDR from Trustless Work:
   - Single-release: `POST /escrow/single-release/approve-milestone`
   - Multi-release: `POST /escrow/multi-release/approve-milestone`
3. The frontend signs the XDR in the authorized user's wallet and submits it
   through `POST /helper/send-transaction`.
4. SafeTrust's scheduled `POST /reconciliation/sync-escrows` reads the
   contract using `GET /helper/get-escrow-by-contract-ids`. The indexer's
   milestone flags and balance determine the observed state.

## Request

| Field        | Type      | Description                                      |
|--------------|-----------|--------------------------------------------------|
| `contractId` | `string`  | TrustlessWork smart contract identifier          |
| `milestoneId`| `string`  | Business milestone identifier: `"check_in"` or `"check_out"` |
| `approver`   | `string`  | Host's Stellar public key (`G...` strkey)        |
| `flag`       | `boolean` | Must be `true` to approve                        |

### Example

```json
{
  "contractId": "CAATN5DTEST00001",
  "milestoneId": "check_in",
  "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
  "flag": true
}
```

### Required Headers

| Header                        | Description                              |
|-------------------------------|------------------------------------------|
| `Content-Type`                | `application/json`                       |
| `x-trustlesswork-signature`   | HMAC-SHA256 signature of the request body |
| `x-trustlesswork-timestamp`   | Unix epoch millisecond timestamp         |

## Milestone Identifiers

The `milestoneId` is a **string business identifier** used in the API. The escrow
contract maps these to numeric indices for on-chain tracking.

| milestoneId  | Contract Index | Meaning              | Reservation Status |
|--------------|----------------|----------------------|--------------------|
| `"check_in"` | `0`            | Guest check-in       | `"checked_in"`     |
| `"check_out"`| `1`            | Guest check-out      | `"checked_out"`    |

The handler uses string comparison (`milestoneId === 'check_in'`) to determine the
reservation status to mirror. Any value other than `"check_in"` results in
`"checked_out"` being set.

## State Transition

```
funded ──────────┐
                 ├── milestone.approved ──► milestone_approved
active ──────────┘
```

The Rust state machine enforces that only `funded` and `active` are valid prior states for
the `milestone_approved` target via the `milestone.approved` event.

## Response

### Success — `200`

```json
{ "received": true }
```

The milestone is now `approved` and the escrow status is `milestone_approved`.

### Success — Idempotent duplicate

If the same milestone approval is retried (same `contractId` + `event_type` including
milestone ID), the handler short-circuits:

```json
{ "received": true }
```

### Error Responses

| Status | Error                                              | When                                          |
|--------|----------------------------------------------------|-----------------------------------------------|
| `400`  | `Missing required fields: contractId, milestoneId, approver, flag` | Any required field is missing |
| `400`  | `flag must be true to approve a milestone`         | `flag` is `false` or not a boolean            |
| `401`  | `Missing x-trustlesswork-signature header`         | HMAC header absent                            |
| `401`  | `Invalid webhook signature`                        | HMAC verification failed                      |
| `404`  | `Escrow not found`                                 | No escrow with the given `contractId`         |
| `404`  | `Milestone not found`                              | No `escrow_milestones` row for the `milestoneId` + escrow |
| `500`  | `Failed to update milestone approval`              | Hasura GraphQL error                          |

## Side Effects

1. **Milestone record updated** — `escrow_milestones` row is set to `status = "approved"`
   with `approvedBy` (wallet address) and `approvedAt` (timestamp).

2. **Escrow status advanced** — `trustless_work_escrows.status` is set to
   `"milestone_approved"` (only if prior state is `funded` or `active`).

3. **Reservation mirror** — The `reservations` table is updated:
   - `check_in` → `status = "checked_in"`
   - `check_out` → `status = "checked_out"`

## Idempotency

The idempotency key is milestone-specific: `milestone.approved:{milestoneId}`. This means
`check_in` and `check_out` approvals are deduplicated independently — approving `check_in`
twice is caught, but approving `check_in` then `check_out` proceeds normally.

## Milestone Lifecycle

In a typical hotel booking:

1. Guest checks in → host approves `check_in` milestone → escrow becomes `milestone_approved`
2. Guest checks out → host approves `check_out` milestone → escrow stays `milestone_approved`
3. After all milestones approved → host (or platform) triggers `release-funds`

Both milestones must be approved before funds can be released. The TrustlessWork contract
enforces this on-chain.

## Wallet Roles

| Role        | Description                                                                                          |
|-------------|------------------------------------------------------------------------------------------------------|
| `approver`  | The host's Stellar wallet that approved the milestone (sent in the callback by TrustlessWork)        |
| `marker`    | The host (hotel) wallet — stored in the escrow record and set during initialization                  |
| `releaser`  | The SafeTrust platform wallet — releases funds after all milestones                                  |

> **Note on naming:** The `approver` field in the `trustless_work_escrows` table stores
> the *guest* wallet address (set during initialization). The `approver` parameter in
> *this* callback is the *host* wallet that approved the milestone — these are
> semantically different despite sharing the name. The handler stores the callback's
> `approver` value in the `escrow_milestones.approved_by` column.

## Error Handling

- **Escrow not found (404):** If no escrow exists for the `contractId`, the lookup query
  returns empty and the handler returns 404.

- **Milestone not found (404):** If the escrow exists but no `escrow_milestones` row matches
  the `milestoneId`, the milestone update returns 0 affected rows.

- **Status guard failure:** If the escrow is not in `funded` or `active`, the Hasura
  mutation returns 0 affected rows, which is treated as "Escrow not found" (404).

## Test Coverage

- **Unit tests (TypeScript):** `webhook/src/routes/escrows/__tests__/approve-milestone.handler.test.ts`
- **Callback tests (TypeScript):** `webhook/src/routes/escrows/__tests__/approve-milestone.handler.callback.test.ts`
- **Integration tests (Karate):** `tests/karate/features/escrows/approve-milestone.feature`
  - Valid approval updates milestone and escrow
  - Milestone-specific idempotency keys
  - Missing fields return 400
  - `flag: false` returns 400
  - Escrow not found returns 404
  - Hasura errors return 500
  - Missing/invalid signature returns 401
For single-release escrows, an approved milestone flag derives
`milestone_approved`. For multi-release escrows, any approved or released
milestone derives `milestone_approved`. The V1 indexer snapshot has no ledger
sequence; under the current freshness policy it cannot safely advance an
already funded escrow to this state by polling alone. A versioned snapshot or
transaction confirmation is required. See
[Trustless Work Indexer](./trustless-work-indexer.md).
