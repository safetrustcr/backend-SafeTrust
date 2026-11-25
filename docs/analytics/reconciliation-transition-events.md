# Reconciliation transition event contract

Escrow analytics must treat an applied lifecycle transition as the canonical
activity record, regardless of whether initialization, milestone approval, or
polling reconciliation discovered it.

Each transition record uses the idempotency identity
`contract_id:event_type:observed_ledger_sequence`. The event insert and escrow
status update must share one database transaction. Replaying the same ledger
state therefore updates neither the status nor the analytics count.

Sync health replaces delivery health: last successful reconciliation time,
ledger lag, repeatedly skipped escrows, and pending confirmation retries.

Until the follow-up migration lands, consumers must not interpret webhook
delivery rows as escrow lifecycle volume.
