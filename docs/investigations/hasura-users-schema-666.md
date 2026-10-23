# Investigation: missing `users` GraphQL operations (issue #666)

No secrets, connection strings or user data belong in this file, the issue or any linked PR.

## What the Schema Registry snapshot is (and is not)

- "30 breaking changes" means 30 GraphQL schema **compatibility** regressions (fields/types removed). It is not 30 vulnerabilities and not evidence that PostgreSQL rows were deleted.
- `no_queries_available` is the placeholder Hasura adds to `query_root` when every query field disappeared. It is the safe fallback, not a new attack surface.
- A historical snapshot (14 Oct 2026 17:41:04) cannot tell us whether the problem still exists. The first step is to compare the **immediately preceding** registry revision with the **current** schema, then check the live deployment.

## Finding from the repository (likely root cause, still to be confirmed on Cloud)

Migration `1779300000001_migrate_to_safetrust_schema` moves `public.users` (and the other tables) into the `safetrust` schema, and `metadata/tenants/safetrust/databases/tables/public_users.yaml` tracks it as `safetrust.users` — the table definition itself is correct (the `public_` filename prefix is only a historical naming convention).

What was missing is the **GraphQL name**. Hasura exposes a table outside the `public` schema as `<schema>_<table>` unless the table has `configuration.custom_name`. `public_users.yaml` had no `configuration` block, so after the schema move `users`, `users_by_pk`, `users_aggregate`, `insert_users`, `update_users`, … became `safetrust_users`, `safetrust_users_by_pk`, … — i.e. every client that still uses the original names loses all users operations. That matches the registry diff (users query/mutation/subscription fields and their types removed). `docs/migrations/safetrust-schema-migration.md` claimed "GraphQL field names: unchanged", which is only true for tables that set a `custom_name` (`roles`, `escrow_milestones`, `trustless_work_escrows`).

`deploy-tenant.sh` passes each YAML's `configuration` straight into `pg_track_tables`, so adding the block is enough; no table, column, row or permission is touched.

## Repair in this PR (narrow)

- `public_users.yaml`: add `configuration.custom_name: users`. Original root fields and type names are restored. Select/update permissions are unchanged.
- `docs/migrations/safetrust-schema-migration.md`: corrected the "GraphQL field names" row.
- `tests/karate/features/users/users-operations.feature`: pins `users`, `users_by_pk`, `users_aggregate` in `query_root`, the absence of `safetrust_users`, and the users mutations. (The old `query.feature` only asked for `__typename`, which is why nothing caught this.)
- `metadata/verify-users-operations.mjs`: read-only verifier for any environment (below).

### Same defect, deliberately not changed here

These tables are also tracked from `safetrust` with no `custom_name`, so their root fields are currently `safetrust_<table>`: `apartments`, `apartment_images`, `bid_requests`, `bid_status_histories`, `user_wallets`, `user_roles`, `pricing_rules`, `pricing_overrides`, `trustless_work_webhook_events`, `escrow_pending_approvals`, `escrow_analytics_by_day`, `escrow_status_summary`. (`reservations` uses `safetrust_reservations` on purpose.) Each one needs a decision — restore the old name, or migrate clients to the prefixed name — and some are used as function return types, so they were left out of this narrowly scoped recovery. **Client migration is tracked here:** open a follow-up per table, starting with `apartments` (`tests/karate/features/apartments/apartment.feature` queries `apartments(...)`).

## Runbook for the live deployment (run by someone with access)

Back up first: `hasura metadata export` to a private location (never commit it). Never clear metadata, drop tables, re-run seeds or expose all tables to silence the warning. Coordinate with HAS-02 (metadata deployment) before changing Cloud.

1. Record, without secrets: the two registry revisions compared, the project/endpoint identifier, the role used, and the incident timeline.
2. Run the verifier against the **explicit** Cloud endpoint (local defaults target localhost, so a green local run proves nothing about Cloud):

   ```powershell
   $env:HASURA_ENDPOINT = "https://<project>.hasura.app"
   $env:HASURA_ADMIN_SECRET = "<from your secret store>"
   $env:GUEST_TOKEN = "<real guest JWT>"
   $env:HOST_TOKEN  = "<real host JWT>"
   node metadata/verify-users-operations.mjs
   ```

   It checks `get_inconsistent_metadata`, that `users` is tracked from `safetrust` with `custom_name: users` and has select permissions, and, **as each real role (no admin bypass)**, that `query_root` and `subscription_root` expose `users`, `safetrust_users` is absent, the schema is not the empty `no_queries_available` one, and `{ users(limit: 1) { id } }` succeeds. Exit code 0 = all checks that ran passed; skipped checks are listed and do not count.
3. If the current schema is already fine (e.g. the registry entry was a temporary deployment snapshot), close #666 as historical with the verifier output as evidence.
4. If it fails, deploy this metadata fix to the affected environment (`HASURA_ADMIN_SECRET=<secret> ./metadata/setup-tenant.sh safetrust --endpoint <explicit-url>`; already-tracked tables are skipped, so re-tracking `users` with its configuration may need `pg_set_table_customization` for that one table) and re-run the verifier.
5. Confirm migration state with `hasura migrate status --database-name safetrust`; rows are untouched either way.
