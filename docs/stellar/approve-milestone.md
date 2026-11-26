# Approve Milestone

> **Status:** The milestone approval webhook/API flow is not wired up in this
> checkout. Reconciliation polling at `POST /reconciliation/sync-escrows`
> can derive the escrow-level `milestone_approved` status from indexed milestone
> flags, but it does not update `escrow_milestones` rows or mirror
> `checked_in`/`checked_out` to reservations.

## Current Behavior

The TrustlessWork indexer reconciliation flow reads escrow data through
`GET /helper/get-escrow-by-contract-ids` and derives the local escrow status.
The four escrow-level V1 flags take precedence over legacy milestone-based
derivation, in this order:

- `isCancelled` → `cancelled`
- `isDisputed` → `disputed`
- `isCompleted` → `completed`
- `isPending` → `pending_funding`

When none of these flags applies, reconciliation falls back to the legacy
milestone-based rules:

- For single-release escrows, an approved milestone derives
  `milestone_approved` only when higher-priority conditions do not apply.
  A resolved escrow derives `resolved`, while a released escrow derives
  `completed` and a disputed escrow derives `disputed`.
- For multi-release escrows, settled and disputed conditions take precedence.
  When all milestones are settled, reconciliation derives `completed` or
  `resolved`; an unresolved disputed milestone derives `disputed`.
  Only then does an approved or released milestone derive
  `milestone_approved`.
- Reconciliation applies only legal local-to-observed transitions and checks
  the observed ledger sequence against the stored sequence when available.

The V1 indexer snapshot is unversioned. Polling cannot safely advance an
already funded escrow to `milestone_approved` without a version token or
transaction confirmation.

See [Trustless Work Indexer](./trustless-work-indexer.md).

## Existing Approval Logic

The codebase retains milestone approval service and repository functions,
including logic to:

- Mark a milestone as `approved`, recording the approver and approval time.
- Transition the escrow to `milestone_approved` from valid prior states.
- Mirror `check_in` to `checked_in` and other milestone IDs to
  `checked_out` in reservations.
- Use milestone-specific webhook idempotency keys.

The service uses the Rust escrow state machine to resolve valid prior states
for the `milestone.approved` event. The current implementation allows
`funded` and `active` as prior states.

These functions and their unit tests remain in the repository, but the
approval webhook/API flow is not wired up in this checkout.

## Future Integration

A future integration must implement and verify the approval route or webhook,
transaction submission, signature verification where applicable, persistence,
reservation updates, and idempotency before documenting it as an operational
flow.
