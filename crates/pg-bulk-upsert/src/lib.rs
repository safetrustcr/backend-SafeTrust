//! pg-bulk-upsert — one-statement escrow UPSERT for SafeTrust reconciliation.
//!
//! Replaces the row-by-row `db.query(UPSERT_ESCROW_SQL, ...)` loop in
//! `webhook/src/lib/reconciliation.js`. That loop sends one INSERT ... ON
//! CONFLICT round-trip per escrow: 50 per chunk, up to 500 per full sync. This
//! addon collapses a whole chunk into a single statement that feeds the rows in
//! through `UNNEST(...)` typed arrays, so the DB overhead per chunk is one round
//! trip instead of fifty.
//!
//! # Exposed function (via Neon / Node-API v6)
//!
//! ```text
//! bulkUpsertEscrows(updatesJson: string, connString: string) => Promise<string>
//! ```
//!
//! `updatesJson` is a JSON array of escrow rows. The return value is a JSON
//! `BulkUpsertResult { rows_affected, unchanged, duration_ms }`.
//!
//! # Parity with the JavaScript path it replaces
//!
//! The SQL mirrors `UPSERT_ESCROW_SQL` exactly:
//!   * inserts the same ten columns (`+ updated_at = NOW()`, `tenant_id`),
//!   * `DO UPDATE` sets the same six synced columns plus `updated_at`
//!     (`escrow_type` is written on insert only, as in the JS version),
//!   * the `WHERE ... IS DISTINCT FROM` guard compares the same six columns, so
//!     rows whose synced fields did not change are left untouched.
//!
//! Because `INSERT ... ON CONFLICT DO UPDATE ... WHERE` counts a conflicting row
//! only when the guard passes, `rows_affected` equals the number of rows the
//! row-by-row loop would have reported as `updated`, and `unchanged = total -
//! rows_affected`. `amount`/`balance` (`DECIMAL(20,7)`) are passed as text and
//! cast with `::numeric`, so decimal values compare by value and never lose
//! precision.

use neon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Instant;
use tokio::runtime::Runtime;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls};

/// One escrow row to upsert. Numeric fields arrive as text so `DECIMAL(20,7)`
/// values keep their exact form (the JS layer stringifies them before the call).
#[derive(Deserialize, Debug, Clone)]
struct EscrowUpdate {
    contract_id: String,
    status: String,
    amount: String,
    balance: String,
    marker: String,
    approver: String,
    releaser: String,
    escrow_type: String,
}

/// Result handed back to JavaScript as JSON.
#[derive(Serialize, Debug, PartialEq)]
struct BulkUpsertResult {
    /// Rows actually inserted or updated (matches the JS `updated` count).
    rows_affected: u64,
    /// Rows present but identical, so skipped by the `IS DISTINCT FROM` guard.
    unchanged: u64,
    duration_ms: u64,
}

/// Bulk UPSERT statement. Byte-for-byte equivalent to `UPSERT_ESCROW_SQL` in
/// `reconciliation.js`, but fed by `UNNEST` arrays instead of one VALUES tuple.
const BULK_UPSERT_SQL: &str = "
    INSERT INTO public.trustless_work_escrows
      (contract_id, status, amount, balance, marker, approver, releaser,
       escrow_type, updated_at, tenant_id)
    SELECT
      u.contract_id, u.status, u.amount::numeric, u.balance::numeric,
      u.marker, u.approver, u.releaser, u.escrow_type, NOW(), 'safetrust'
    FROM UNNEST(
      $1::text[], $2::text[], $3::text[], $4::text[],
      $5::text[], $6::text[], $7::text[], $8::text[]
    ) AS u(contract_id, status, amount, balance, marker, approver, releaser, escrow_type)
    ON CONFLICT (contract_id) DO UPDATE SET
      status     = EXCLUDED.status,
      amount     = EXCLUDED.amount,
      balance    = EXCLUDED.balance,
      marker     = EXCLUDED.marker,
      approver   = EXCLUDED.approver,
      releaser   = EXCLUDED.releaser,
      updated_at = NOW()
    WHERE (
      public.trustless_work_escrows.status,
      public.trustless_work_escrows.amount,
      public.trustless_work_escrows.balance,
      public.trustless_work_escrows.marker,
      public.trustless_work_escrows.approver,
      public.trustless_work_escrows.releaser
    ) IS DISTINCT FROM (
      EXCLUDED.status,
      EXCLUDED.amount,
      EXCLUDED.balance,
      EXCLUDED.marker,
      EXCLUDED.approver,
      EXCLUDED.releaser
    )
";

// ─── Pure logic (unit-tested without a Node.js runtime or a database) ─────────

/// Column-major view of the updates, ready to bind as eight `text[]` params.
/// Borrows from `updates`, so nothing is cloned.
struct Columns<'a> {
    contract_ids: Vec<&'a str>,
    statuses: Vec<&'a str>,
    amounts: Vec<&'a str>,
    balances: Vec<&'a str>,
    markers: Vec<&'a str>,
    approvers: Vec<&'a str>,
    releasers: Vec<&'a str>,
    escrow_types: Vec<&'a str>,
}

fn to_columns(updates: &[EscrowUpdate]) -> Columns<'_> {
    let mut c = Columns {
        contract_ids: Vec::with_capacity(updates.len()),
        statuses: Vec::with_capacity(updates.len()),
        amounts: Vec::with_capacity(updates.len()),
        balances: Vec::with_capacity(updates.len()),
        markers: Vec::with_capacity(updates.len()),
        approvers: Vec::with_capacity(updates.len()),
        releasers: Vec::with_capacity(updates.len()),
        escrow_types: Vec::with_capacity(updates.len()),
    };
    for u in updates {
        c.contract_ids.push(&u.contract_id);
        c.statuses.push(&u.status);
        c.amounts.push(&u.amount);
        c.balances.push(&u.balance);
        c.markers.push(&u.marker);
        c.approvers.push(&u.approver);
        c.releasers.push(&u.releaser);
        c.escrow_types.push(&u.escrow_type);
    }
    c
}

fn parse_updates(updates_json: &str) -> Result<Vec<EscrowUpdate>, String> {
    serde_json::from_str(updates_json).map_err(|e| format!("invalid updates JSON: {e}"))
}

/// Drop duplicate `contract_id`s, keeping the last occurrence. PostgreSQL rejects
/// an `INSERT ... ON CONFLICT DO UPDATE` that touches the same conflict target
/// twice in one statement, so the bulk path must send each id at most once. The
/// row-by-row loop applies writes in order (last write wins), so keeping the last
/// occurrence leaves the same final row — and avoids aborting the whole chunk.
fn dedupe_last_wins(updates: Vec<EscrowUpdate>) -> Vec<EscrowUpdate> {
    use std::collections::HashMap;
    let mut position: HashMap<String, usize> = HashMap::with_capacity(updates.len());
    let mut result: Vec<EscrowUpdate> = Vec::with_capacity(updates.len());
    for u in updates {
        match position.get(&u.contract_id) {
            Some(&i) => result[i] = u, // later duplicate overwrites the earlier one
            None => {
                position.insert(u.contract_id.clone(), result.len());
                result.push(u);
            }
        }
    }
    result
}

// ─── Shared runtime + self-healing connection ─────────────────────────────────

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        Runtime::new().expect("failed to initialise Tokio runtime for pg-bulk-upsert")
    })
}

/// Cached connection, keyed by its connection string. Reused across calls so we
/// pay the connect handshake once, and transparently reconnected if the server
/// closed it. Calls are serialised by the synchronous Neon bridge, so the mutex
/// is effectively uncontended.
fn connection_cell() -> &'static Mutex<Option<(String, Client)>> {
    static CELL: OnceLock<Mutex<Option<(String, Client)>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

async fn run_bulk_upsert(updates: &[EscrowUpdate], conn_string: &str) -> Result<u64, String> {
    let cols = to_columns(updates);

    let mut guard = connection_cell().lock().await;

    // (Re)connect when there is no client, the server closed it, or the target
    // connection string changed.
    let needs_connect = match guard.as_ref() {
        Some((cached, client)) => cached != conn_string || client.is_closed(),
        None => true,
    };
    if needs_connect {
        let (client, connection) = tokio_postgres::connect(conn_string, NoTls)
            .await
            .map_err(|e| format!("DB connect failed: {e}"))?;
        // Drive the connection in the background on the shared runtime.
        runtime().spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("[pg-bulk-upsert] connection error: {e}");
            }
        });
        *guard = Some((conn_string.to_string(), client));
    }

    let client = &guard.as_ref().expect("client set above").1;
    client
        .execute(
            BULK_UPSERT_SQL,
            &[
                &cols.contract_ids,
                &cols.statuses,
                &cols.amounts,
                &cols.balances,
                &cols.markers,
                &cols.approvers,
                &cols.releasers,
                &cols.escrow_types,
            ],
        )
        .await
        .map_err(|e| {
            // Drop the client on failure so the next call reconnects cleanly.
            *guard = None;
            format!("Bulk upsert failed: {e}")
        })
}

// ─── Neon export ──────────────────────────────────────────────────────────────

/// `bulkUpsertEscrows(updatesJson, connString)`.
///
/// Returns a `Promise<string>` and does NOT block the Node.js event loop: the
/// statement runs on the shared Tokio runtime and the promise is settled back on
/// the JS thread via a Neon `Channel`. The promise rejects only for a caller
/// mistake (malformed `updatesJson`); a connect/query failure is surfaced as a
/// rejection too, which the JS layer catches and falls back to row-by-row.
fn bulk_upsert_escrows(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let updates_json = cx.argument::<JsString>(0)?.value(&mut cx);
    let conn_string = cx.argument::<JsString>(1)?.value(&mut cx);

    let (deferred, promise) = cx.promise();
    let channel = cx.channel();

    let updates = match parse_updates(&updates_json) {
        // Deduplicate so a chunk with a repeated contract_id never aborts the
        // whole statement (see dedupe_last_wins).
        Ok(u) => dedupe_last_wins(u),
        Err(e) => {
            let error = cx.error(e)?;
            deferred.reject(&mut cx, error);
            return Ok(promise);
        }
    };

    // Nothing to do — resolve without opening a DB connection.
    if updates.is_empty() {
        let result = BulkUpsertResult { rows_affected: 0, unchanged: 0, duration_ms: 0 };
        let json = serde_json::to_string(&result).expect("serialises");
        deferred.settle_with(&channel, move |mut cx| Ok(cx.string(json)));
        return Ok(promise);
    }

    let total = updates.len() as u64;

    // Run the statement on the Tokio runtime, then settle the promise on the JS
    // thread. `settle_with` schedules its closure on the event loop via `channel`.
    runtime().spawn(async move {
        let started = Instant::now();
        let outcome = run_bulk_upsert(&updates, &conn_string).await;
        let duration_ms = started.elapsed().as_millis() as u64;

        deferred.settle_with(&channel, move |mut cx| match outcome {
            Ok(rows_affected) => {
                let result = BulkUpsertResult {
                    rows_affected,
                    unchanged: total.saturating_sub(rows_affected),
                    duration_ms,
                };
                let json = serde_json::to_string(&result)
                    .or_else(|e| cx.throw_error(format!("failed to serialise result: {e}")))?;
                Ok(cx.string(json))
            }
            Err(e) => cx.throw_error(e),
        });
    });

    Ok(promise)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("bulkUpsertEscrows", bulk_upsert_escrows)?;
    Ok(())
}

// ─── Unit tests (`cargo test`) ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> EscrowUpdate {
        EscrowUpdate {
            contract_id: id.to_string(),
            status: "funded".to_string(),
            amount: "100.0000000".to_string(),
            balance: "50.0000000".to_string(),
            marker: "M".to_string(),
            approver: "A".to_string(),
            releaser: "R".to_string(),
            escrow_type: "single_release".to_string(),
        }
    }

    #[test]
    fn parses_full_escrow_rows() {
        let json = r#"[
            {"contract_id":"C1","status":"funded","amount":"100.0000000",
             "balance":"50.0000000","marker":"M","approver":"A","releaser":"R",
             "escrow_type":"single_release"}
        ]"#;
        let updates = parse_updates(json).unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].contract_id, "C1");
        assert_eq!(updates[0].amount, "100.0000000");
        assert_eq!(updates[0].escrow_type, "single_release");
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_updates("{not json").is_err());
        // Missing required fields is a parse error, not a silent default.
        assert!(parse_updates(r#"[{"contract_id":"C1"}]"#).is_err());
    }

    #[test]
    fn to_columns_is_column_major_and_order_preserving() {
        let updates = vec![sample("C1"), sample("C2"), sample("C3")];
        let c = to_columns(&updates);
        assert_eq!(c.contract_ids, vec!["C1", "C2", "C3"]);
        assert_eq!(c.statuses.len(), 3);
        assert_eq!(c.amounts, vec!["100.0000000", "100.0000000", "100.0000000"]);
        // Every column has one entry per row.
        for col in [&c.balances, &c.markers, &c.approvers, &c.releasers, &c.escrow_types] {
            assert_eq!(col.len(), 3);
        }
    }

    #[test]
    fn dedupe_last_wins_keeps_last_occurrence_in_first_seen_order() {
        let mut a = sample("C1");
        a.balance = "1".to_string();
        let mut b = sample("C2");
        b.balance = "2".to_string();
        let mut a2 = sample("C1"); // duplicate of C1, later value
        a2.balance = "9".to_string();

        let deduped = dedupe_last_wins(vec![a, b, a2]);
        assert_eq!(deduped.len(), 2, "one row per contract_id");
        // Order follows first appearance (C1, C2); C1 carries the LAST value.
        assert_eq!(deduped[0].contract_id, "C1");
        assert_eq!(deduped[0].balance, "9");
        assert_eq!(deduped[1].contract_id, "C2");
        assert_eq!(deduped[1].balance, "2");
    }

    #[test]
    fn dedupe_last_wins_is_noop_without_duplicates() {
        let deduped = dedupe_last_wins(vec![sample("C1"), sample("C2"), sample("C3")]);
        let ids: Vec<_> = deduped.iter().map(|u| u.contract_id.as_str()).collect();
        assert_eq!(ids, vec!["C1", "C2", "C3"]);
    }

    #[test]
    fn empty_updates_produce_empty_columns() {
        let c = to_columns(&[]);
        assert!(c.contract_ids.is_empty());
        assert!(c.amounts.is_empty());
    }

    #[test]
    fn result_serialises_expected_shape() {
        let r = BulkUpsertResult { rows_affected: 7, unchanged: 3, duration_ms: 8 };
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(json, r#"{"rows_affected":7,"unchanged":3,"duration_ms":8}"#);
    }

    #[test]
    fn sql_mirrors_the_js_upsert_contract() {
        // Guard rails: the statement keeps the exact parity that makes the counts
        // line up with the row-by-row path.
        assert!(BULK_UPSERT_SQL.contains("ON CONFLICT (contract_id) DO UPDATE"));
        assert!(BULK_UPSERT_SQL.contains("IS DISTINCT FROM"));
        assert!(BULK_UPSERT_SQL.contains("UNNEST"));
        // escrow_type is inserted but never in the DO UPDATE SET list.
        let set_clause = BULK_UPSERT_SQL.split("DO UPDATE SET").nth(1).unwrap();
        let set_body = set_clause.split("WHERE").next().unwrap();
        assert!(!set_body.contains("escrow_type"));
    }
}
