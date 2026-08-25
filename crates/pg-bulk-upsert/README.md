# pg-bulk-upsert

Rust-native bulk UPSERT for the SafeTrust reconciliation service, exposed to
Node.js via **Neon** (Node-API v6).

Today, after a chunk of escrow state comes back from the TrustlessWork indexer,
[`reconciliation.js`](../../webhook/src/lib/reconciliation.js) writes it back one
row at a time: 50 `INSERT ... ON CONFLICT` round trips per chunk, up to 500 per
full sync. This addon folds an entire chunk into a single statement that streams
the rows in through `UNNEST(...)` typed arrays, so the database cost per chunk is
one round trip instead of fifty.

## What it provides

| JS export           | Signature |
| ------------------- | --------- |
| `bulkUpsertEscrows` | `(updatesJson: string, connString: string) => string` |

`updatesJson` is a JSON array of escrow rows. The return value is a JSON
`BulkUpsertResult`:

```ts
interface BulkUpsertResult {
  rows_affected: number // rows actually inserted or updated (= the JS `updated` count)
  unchanged: number     // rows present but identical, skipped by IS DISTINCT FROM
  duration_ms: number
}
```

See [`index.d.ts`](./index.d.ts) for the full typed contract.

## Parity with the row-by-row path

The statement is a byte-for-byte mirror of `UPSERT_ESCROW_SQL` in
`reconciliation.js`:

- inserts the same ten columns, with `updated_at = NOW()` and `tenant_id`,
- `DO UPDATE` sets the same six synced columns plus `updated_at` (`escrow_type`
  is written on insert only, exactly as the JS version does),
- the `WHERE ... IS DISTINCT FROM` guard compares the same six columns, so an
  unchanged row is left untouched.

Because `INSERT ... ON CONFLICT DO UPDATE ... WHERE` counts a conflicting row
only when the guard passes, `rows_affected` equals the number the row-by-row
loop would report as `updated`, and `unchanged = total - rows_affected`. The
`amount` and `balance` columns (`DECIMAL(20,7)`) are sent as text and cast with
`::numeric`, so values compare by magnitude and keep full precision.

## Enabling it

Gated behind an environment flag; default behaviour is unchanged.

```bash
RUST_BULK_UPSERT_ENABLED=true
```

It reuses the existing `POSTGRES_HOST/PORT/DB/USER/PASSWORD` vars to build its
connection string (NoTls, matching the Node pg pool). If the addon is missing,
the statement fails, or anything else goes wrong, `reconciliation.js` logs a
warning and falls back to the row-by-row loop, so the endpoint never breaks.

## Build

Prerequisites: Rust toolchain. Targets Node-API v6 (ABI-stable across Node
versions). Uses `tokio-postgres` with NoTls, so there is no system OpenSSL
dependency and it builds cleanly on Alpine/musl.

```bash
# From the repo root — pg-bulk-upsert is a workspace member:
cargo build --release -p pg-bulk-upsert
node crates/pg-bulk-upsert/copy-native.js   # -> crates/pg-bulk-upsert/index.node

# Or as part of the webhook build (builds all addons + TypeScript):
cd webhook && npm run build
```

## Test

```bash
cargo test -p pg-bulk-upsert       # pure columnar-transform + parity tests

# End-to-end benchmark against a real PostgreSQL (row-by-row vs bulk):
node crates/pg-bulk-upsert/benchmark.js
```

`benchmark.js` creates a scratch database, seeds rows, and prints the
row-by-row-vs-bulk timing and speedup used in the PR description. Connection
defaults to `127.0.0.1:5432 postgres/postgrespassword`; override with
`PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD`.
