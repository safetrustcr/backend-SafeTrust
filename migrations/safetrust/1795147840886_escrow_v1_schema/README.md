# Trustless Work V1 escrow schema

This migration adds the external `engagement_id`, the six V1 role fields,
raw `flags`, and milestone `index`/`evidence` fields. SafeTrust's `id` remains
the internal UUID primary key; `engagement_id` identifies the Trustless Work
escrow and is intentionally nullable for pre-migration rows.

The existing `status` column is retained because SafeTrust state-machine and
analytics code depends on it. The application derives it from V1 flags using
the following first-match precedence:

1. `isCancelled = true` -> `cancelled`
2. `isDisputed = true` -> `disputed`
3. `isCompleted = true` -> `completed`
4. `isPending = true` -> `pending_funding`
5. otherwise -> `created` (or the existing legacy derivation during rollout)

Rollback copies populated V1-only fields into each row's existing metadata
JSON under `twV1` before dropping the typed columns, so rollback does not
discard reconciliation data.

`trustless_work_webhook_events` remains tracked for existing analytics, but it
has no Hasura event trigger: Trustless Work does not post rows to that table.
