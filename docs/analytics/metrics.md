# Analytics metric dictionary

Definitions for every metric returned by the SafeTrust analytics functions. If a
metric's SQL changes, update this file in the same migration PR.

## Conventions

| Topic | Rule |
| --- | --- |
| Time basis | Every daily bucket is a **UTC calendar day**: `[day 00:00Z, day + 1 00:00Z)`. Timestamps are converted with `AT TIME ZONE 'UTC'`, so results don't depend on the server or session time zone. |
| Date range | `getEscrowAnalyticsByDay` takes `p_start_date` and `p_end_date` as GraphQL `date` values. Both ends are inclusive and the range can cover at most 367 days (`p_end_date - p_start_date ≤ 366`). Every day in the range returns a row, with `0` when there is no data. |
| Scope | Rows are filtered by tenant (`p_tenant_id` / `tenant_id_input`), except for user metrics. `safetrust.users` has no `tenant_id` column and is tenant-scoped only by its schema. Session-derived tenant scope replaces the browser argument in ANA-02 (#695). |
| Currency | **Single-asset policy: USDC.** All value metrics sum `amount` only where `asset_code = 'USDC'` and exclude other assets. Values are **nominal** escrow amounts in USDC units. They aren't TVL, revenue, or fees. `asset_issuer` isn't checked. |
| Freshness | Computed live on every query (`STABLE` functions, no cache or materialization). A metric is as fresh as its source table. |

## `getEscrowAnalyticsByDay` — `safetrust.get_escrow_analytics_by_day(date, date, varchar)`

| Metric | Source | Unit | Time basis | Definition | Known limitations |
| --- | --- | --- | --- | --- | --- |
| `day` | generated series | date | UTC day | One row per day in `[p_start_date, p_end_date]`. | — |
| `webhook_records` | `trustless_work_webhook_events` | rows | `created_at` | Every webhook row stored that day, including duplicate deliveries and redeliveries of the same event. | Measures delivery volume, not activity. Use it for webhook operations, not product usage. |
| `lifecycle_events` | `trustless_work_webhook_events` | events | first `created_at` per key | Unique escrow lifecycle events, deduplicated on `(contract_id, event_type)`, which is the key the webhook handler deduplicates on. Each event counts once, on the UTC day its first copy was received. | An event first received before `p_start_date` isn't counted, even if it's redelivered inside the range. Rows without a `contract_id` can't be deduplicated, so each one counts separately. A legitimate repeat of the same event type on the same contract counts once. |
| `processed_events` | `trustless_work_webhook_events` | rows | `processed_at` | Webhook rows whose processing succeeded that day (`processed = true`). | Point-in-time once written: a retry that succeeds later adds to the day it succeeded and doesn't rewrite the day the webhook arrived. Duplicate deliveries are stored with `processed = false`, so they aren't counted. |
| `last_active_users` | `users.last_seen` | users | `last_seen` | Users whose **most recent** activity falls on that day. | `last_seen` changes over time. A returning user moves to their newest day and drops out of earlier days, so past buckets shrink over time. This isn't a sign-up or new-user metric, because `users` has no `created_at` column. |
| `escrows_created` | `trustless_work_escrows` | escrows | `created_at` | Escrows created that day. | Changes only if escrow rows are deleted. |
| `cohort_active_escrows` | `trustless_work_escrows` | escrows | `created_at` (cohort) + current `status` | Of the escrows created that day, how many are **currently** `funded`, `active` or `milestone_approved`. | Not a point-in-time count of escrows that were active on that day. Past buckets change as escrows in the cohort complete. A historical count needs a status history table. |
| `cohort_active_value_usdc` | `trustless_work_escrows.amount` | USDC (nominal) | same as `cohort_active_escrows` | Sum of `amount` for the cohort's currently active USDC escrows. | Excludes non-USDC escrows. Same cohort semantics as `cohort_active_escrows`. |

## `get_escrow_status_summary(varchar)`

These are current-state totals with no time basis.

| Metric | Statuses included | Definition | Notes |
| --- | --- | --- | --- |
| `total_escrows` | all | Every escrow for the tenant. | Counts escrows in every asset. |
| `active_escrows` | `funded`, `active`, `milestone_approved` | Escrows currently holding funds that aren't in dispute. | — |
| `completed_escrows` | `completed` | Escrows released normally. | — |
| `disputed_escrows` | `disputed` | Escrows currently in dispute. | — |
| `total_value_usdc` | every status except `cancelled` | Nominal USDC value of escrows booked through the platform. | `cancelled` escrows never settled, so they're excluded. `resolved` escrows settled through dispute resolution, so they count, the same as `completed`. Before ANA-03, `resolved` was excluded with no stated reason. |
| `pending_value_usdc` | `created`, `pending_funding` | Nominal USDC value of escrows that aren't funded yet. | This amount is included in `total_value_usdc`. |

## Renames from the previous definitions (ANA-03)

| Previous field | Replacement | Why |
| --- | --- | --- |
| `event_count` | `webhook_records`, `lifecycle_events` | It counted raw rows, duplicates included. |
| `processed_count` | `processed_events` | It was bucketed by the row's `created_at`, so old days changed when a retry succeeded. |
| `new_users` | `last_active_users` | It was grouped by the mutable `last_seen`, so it never measured new users. |
| `active_escrows` (daily) | `escrows_created`, `cohort_active_escrows` | It showed a creation cohort's current status, not activity on that day. |
| `escrow_value` | `cohort_active_value_usdc` | It summed amounts in mixed assets. |
| `total_value` / `pending_value` | `total_value_usdc` / `pending_value_usdc` | USDC-only policy, and an explicit status set. |

## Dashboard labels

The dashboard (`dApp-SafeTrust`, `apps/frontend/src/hooks/use-analytics-data.ts`) should show these labels instead of "Page Views" and "Interactions":

| Field | Label |
| --- | --- |
| `lifecycle_events` | Escrow lifecycle events |
| `webhook_records` | Webhook deliveries received |
| `processed_events` | Webhook events processed |
| `last_active_users` | Users last active |
| `escrows_created` | Escrows created |
| `cohort_active_value_usdc` | Nominal value still active (USDC) |

"Avg Actions/User" has no valid equivalent. `last_active_users` isn't a per-day active-user denominator, so remove this card instead of relabeling it.
