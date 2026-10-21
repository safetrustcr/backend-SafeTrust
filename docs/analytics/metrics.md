# Analytics and operational health metrics

## Webhook and synchronization health

The `get_webhook_health_summary` GraphQL query is available to the `admin`
role only. Its summary is aggregated from existing SafeTrust tables; it does
not add or write to any event or telemetry tables.

| Field | Source and meaning |
| --- | --- |
| `pending_count` | Number of rows in `trustless_work_webhook_events` where `processed` is false or null. |
| `failed_count` | Number of rows in `trustless_work_webhook_events` where `error_message` is not null. |
| `oldest_unprocessed_age_minutes` | Minutes since the oldest unprocessed event's `created_at`, rounded to two decimal places; null when no unprocessed event exists. |
| `last_sync_at` | Latest `updated_at` among `trustless_work_escrows` and `escrow_transactions`. These tables have no dedicated sync timestamp, so this is a source-update proxy, not proof of a completed synchronization. |
| `sync_lag_seconds` | Seconds since that latest source `updated_at`; null when neither source table has a row. |

The event table also contains `retry_count`, `max_retries`, and
`next_retry_at`; it has an `error_message` column, not an `errors` column. The
summary deliberately does not infer failure from exhausted retries or expose
retry scheduling: `failed_count` uses the recorded `error_message`, and
`pending_count` uses `processed`. It does not compute a failure rate.

The SQL function restricts non-admin aggregation to the
`x-hasura-tenant-id` session claim, which Hasura supplies from its authenticated
session. A non-admin call without that claim is rejected. Hasura tracks the
function using a view return type that grants select permission only to `admin`;
therefore `safetrust_user`, `anonymous`, and other non-admin roles cannot
access the GraphQL field.

These fields are a minimal database summary, not a monitoring or alerting
system. Prometheus metrics, cloud monitoring, alerting, and broader operational
observability depend on the deployment edition and are explicitly out of
scope.
