//! pg-bulk-upsert — atomic freshness-checked escrow state persistence for SafeTrust.
//!
//! # Critical Ordering Architecture & Invariants
//!
//! ### 1. Why `received_at` is NOT a valid ordering proxy
//! `received_at` captures only the arbitrary wall-clock arrival time of an HTTP request,
//! webhook payload, or indexer response at the backend server. Due to network delays,
//! variable backoff retries, packet reordering, and asynchronous message queues, an observation
//! originating from an earlier blockchain state (e.g. ledger 100) can easily arrive at the
//! application server AFTER an observation originating from a later state (e.g. ledger 105).
//! Using `received_at` for ordering decisions inevitably causes state regression (e.g. a delayed
//! "funded" snapshot overwriting a "completed" escrow and restoring a nonzero balance).
//! The ONLY authoritative ordering token is the on-chain ledger sequence number (`ledger_seq`).
//! Never use `received_at` for ordering decisions.
//!
//! ### 2. The Unversioned Snapshot Policy
//! When an incoming snapshot lacks a `ledger_seq` (e.g. legacy sources or unindexed observations),
//! it cannot be positioned relative to the blockchain timeline. To prevent silent corruption:
//! - Unversioned snapshots may ONLY update records in pending states (`created`, `pending_funding`,
//!   `deploying`, `pending_signature`).
//! - Unversioned snapshots must NEVER update confirmed or terminal records (`completed`, `resolved`,
//!   `cancelled`, `funded`, `active`, `milestone_approved`).
//! - Exact token amounts must be preserved: unversioned snapshots must NEVER zero out or reduce
//!   nonzero balances stored on confirmed or existing records.
//!
//! ### 3. The Four Conflict Cases and Outcomes
//! When comparing incoming `incoming_seq` against stored `stored_seq`:
//! 1. **Incoming newer (`incoming_seq > stored_seq`)**: Write succeeds. Update status, balance,
//!    and `ledger_seq`, provided terminal state protection, valid state machine transition, and
//!    network/contract identity checks pass.
//! 2. **Incoming older (`incoming_seq < stored_seq`)**: Reject silently. No write, no error.
//! 3. **Equal seq, same values (`incoming_seq == stored_seq` && status/balance identical)**:
//!    Idempotent replay. No write, no error.
//! 4. **Equal seq, different values (`incoming_seq == stored_seq` && status/balance differ)**:
//!    Preserve stored confirmed state and emit a warning conflict log entry. No write, no error.
//!
//! ### 4. Why Terminal States Must NOT Be Ordered by Numeric Status Rank
//! Terminal states (`completed`, `resolved`, `cancelled`) represent final, legally and financially
//! binding lifecycle conclusions where funds have been irreversibly released or returned.
//! Modeling lifecycle states with a numeric integer rank (e.g., rank(cancelled) > rank(completed))
//! creates a false linear ordering. In reality, once an escrow reaches `completed` or `resolved`,
//! funds are disbursed. An out-of-order `cancelled` event must NEVER overwrite a `completed` record.
//! Terminal states must never be overwritten or transition to non-terminal states regardless of
//! sequence number or status rank.

use neon::prelude::*;
use serde::{Deserialize, Deserializer, Serialize};
use std::sync::OnceLock;
use std::time::Instant;
use tokio::runtime::Runtime;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls};

#[path = "../../escrow-state-machine/src/states.rs"]
pub mod states;
#[path = "../../escrow-state-machine/src/transitions.rs"]
pub mod transitions;
#[path = "../../escrow-state-machine/src/validator.rs"]
pub mod validator;

pub const SELECT_LOCK_SQL: &str = "
    SELECT ledger_seq, status, balance::text, network
    FROM escrow_transactions
    WHERE id::text = $1 OR contract_id = $1
    FOR UPDATE
";

pub const UPDATE_ROW_SQL: &str = "
    UPDATE escrow_transactions
    SET status = $2,
        balance = $3::numeric,
        ledger_seq = $4,
        updated_at = NOW()
    WHERE id::text = $1 OR contract_id = $1
";

pub const INSERT_ROW_SQL: &str = "
    INSERT INTO escrow_transactions
      (contract_id, status, amount, balance, ledger_seq, updated_at, tenant_id)
    VALUES ($1, $2, $3::numeric, $4::numeric, $5, NOW(), 'safetrust')
    ON CONFLICT (contract_id) DO NOTHING
";

fn deserialize_optional_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    let v: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(num)) => num
            .as_i64()
            .ok_or_else(|| serde::de::Error::custom("invalid integer for ledger_seq"))
            .map(Some),
        Some(serde_json::Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                trimmed
                    .parse::<i64>()
                    .map(Some)
                    .map_err(serde::de::Error::custom)
            }
        }
        _ => Err(serde::de::Error::custom(
            "ledger_seq must be an integer, numeric string, or null",
        )),
    }
}

/// One escrow row to upsert. Numeric fields arrive as text so `DECIMAL(20,7)`
/// values keep their exact form without floating-point precision loss.
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
pub struct EscrowUpdate {
    #[serde(default)]
    pub id: Option<String>,
    pub contract_id: String,
    pub status: String,
    pub amount: String,
    pub balance: String,
    #[serde(default)]
    pub marker: String,
    #[serde(default)]
    pub approver: String,
    #[serde(default)]
    pub releaser: String,
    #[serde(default)]
    pub escrow_type: String,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    pub ledger_seq: Option<i64>,
    #[serde(default)]
    pub network: Option<String>,
}

/// Stored database state for an escrow record.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredEscrowRow {
    pub id: String,
    pub contract_id: String,
    pub status: String,
    pub balance: String,
    pub ledger_seq: Option<i64>,
    pub network: Option<String>,
}

/// Decision outcome for applying an incoming observation to an existing or new escrow record.
#[derive(Debug, PartialEq, Eq)]
pub enum EvaluationOutcome {
    Write {
        new_status: String,
        new_balance: String,
        new_ledger_seq: Option<i64>,
    },
    RejectStale,
    IdempotentUnchanged,
    ConflictLogEntry {
        reason: String,
    },
    RejectTerminal {
        stored_status: String,
    },
    RejectUnversionedForConfirmed {
        stored_status: String,
    },
    RejectInvalidTransition {
        from: String,
        to: String,
    },
    RejectNetworkMismatch {
        stored: String,
        incoming: String,
    },
}

/// Result handed back to JavaScript as JSON.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct BulkUpsertResult {
    pub rows_affected: u64,
    pub unchanged: u64,
    pub duration_ms: u64,
}

// ─── Pure Freshness & Ordering Logic ─────────────────────────────────────────

fn is_nonzero_balance(balance_str: &str) -> bool {
    let trimmed = balance_str.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.chars().any(|c| ('1'..='9').contains(&c))
}

fn is_zero_balance(balance_str: &str) -> bool {
    !is_nonzero_balance(balance_str)
}

fn normalize_decimal(s: &str) -> (bool, String, String) {
    let (is_neg, s) = if let Some(stripped) = s.strip_prefix('-') {
        (true, stripped)
    } else {
        (false, s)
    };
    let parts: Vec<&str> = s.split('.').collect();
    let int_raw = parts.first().unwrap_or(&"0").trim_start_matches('0');
    let int_str = if int_raw.is_empty() { "0" } else { int_raw };
    let frac_raw = if parts.len() > 1 {
        parts[1].trim_end_matches('0')
    } else {
        ""
    };
    if int_str == "0" && frac_raw.is_empty() {
        (false, "0".to_string(), "".to_string())
    } else {
        (is_neg, int_str.to_string(), frac_raw.to_string())
    }
}

pub fn balances_equal(a: &str, b: &str) -> bool {
    let a_trim = a.trim();
    let b_trim = b.trim();
    if a_trim == b_trim {
        return true;
    }
    normalize_decimal(a_trim) == normalize_decimal(b_trim)
}

fn can_transition_str(from: &str, to: &str) -> bool {
    use crate::states::EscrowStatus;
    use crate::validator::can_transition_status;

    let from_status = match EscrowStatus::from_str(from) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let to_status = match EscrowStatus::from_str(to) {
        Ok(s) => s,
        Err(_) => return false,
    };
    can_transition_status(&from_status, &to_status)
}

/// Evaluates an incoming observation against stored record state according to
/// the four conflict cases and security invariants.
pub fn evaluate_observation(
    stored: Option<&StoredEscrowRow>,
    incoming: &EscrowUpdate,
) -> EvaluationOutcome {
    let Some(stored) = stored else {
        // Record does not exist yet. Insert initial state.
        return EvaluationOutcome::Write {
            new_status: incoming.status.clone(),
            new_balance: incoming.balance.clone(),
            new_ledger_seq: incoming.ledger_seq,
        };
    };

    // 1. Network and contract identity validation
    // A testnet observation must never update a mainnet escrow record.
    if let (Some(stored_net), Some(incoming_net)) = (&stored.network, &incoming.network) {
        let norm_stored = stored_net
            .trim()
            .trim_start_matches("stellar:")
            .to_lowercase();
        let norm_incoming = incoming_net
            .trim()
            .trim_start_matches("stellar:")
            .to_lowercase();
        if norm_stored == "mainnet" && norm_incoming == "testnet" {
            return EvaluationOutcome::RejectNetworkMismatch {
                stored: stored_net.clone(),
                incoming: incoming_net.clone(),
            };
        }
        if !norm_stored.is_empty() && !norm_incoming.is_empty() && norm_stored != norm_incoming {
            return EvaluationOutcome::RejectNetworkMismatch {
                stored: stored_net.clone(),
                incoming: incoming_net.clone(),
            };
        }
    }

    if stored.contract_id != incoming.contract_id && !incoming.contract_id.is_empty() {
        return EvaluationOutcome::RejectNetworkMismatch {
            stored: stored.contract_id.clone(),
            incoming: incoming.contract_id.clone(),
        };
    }

    // 2. Terminal state protection:
    // Completed and Resolved escrows represent finalized on-chain settlements.
    // They must NEVER be overwritten regardless of incoming sequence number.
    // Specifically: cancelled must not be reachable from completed.
    let stored_status_norm = stored.status.trim().to_lowercase();
    let incoming_status_norm = incoming.status.trim().to_lowercase();

    if stored_status_norm == "completed" || stored_status_norm == "resolved" {
        return EvaluationOutcome::RejectTerminal {
            stored_status: stored.status.clone(),
        };
    }

    if stored_status_norm == "cancelled" && incoming_status_norm != "cancelled" {
        return EvaluationOutcome::RejectTerminal {
            stored_status: stored.status.clone(),
        };
    }

    // 3. Unversioned snapshot policy:
    // When incoming has no ledger_seq, it cannot be sequenced against on-chain history.
    // Unversioned snapshots are written only to pending records, NEVER to confirmed records
    // (completed, resolved, cancelled, funded, active, milestone_approved).
    if incoming.ledger_seq.is_none() {
        let is_stored_pending = matches!(
            stored_status_norm.as_str(),
            "created" | "pending_funding" | "deploying" | "pending_signature"
        );
        if !is_stored_pending {
            return EvaluationOutcome::RejectUnversionedForConfirmed {
                stored_status: stored.status.clone(),
            };
        }

        // Exact token amounts must be preserved — no rounding, no estimated balances,
        // no zeroing of nonzero balances from unversioned snapshots.
        let final_balance =
            if is_nonzero_balance(&stored.balance) && is_zero_balance(&incoming.balance) {
                stored.balance.clone()
            } else {
                incoming.balance.clone()
            };

        if !can_transition_str(&stored_status_norm, &incoming_status_norm) {
            return EvaluationOutcome::RejectInvalidTransition {
                from: stored.status.clone(),
                to: incoming.status.clone(),
            };
        }

        return EvaluationOutcome::Write {
            new_status: incoming.status.clone(),
            new_balance: final_balance,
            new_ledger_seq: stored.ledger_seq,
        };
    }

    let incoming_seq = incoming.ledger_seq.unwrap();

    // 4. Versioned comparison against stored sequence
    match stored.ledger_seq {
        None => {
            // Stored record was unversioned. Incoming is versioned.
            if !can_transition_str(&stored_status_norm, &incoming_status_norm) {
                return EvaluationOutcome::RejectInvalidTransition {
                    from: stored.status.clone(),
                    to: incoming.status.clone(),
                };
            }
            EvaluationOutcome::Write {
                new_status: incoming.status.clone(),
                new_balance: incoming.balance.clone(),
                new_ledger_seq: Some(incoming_seq),
            }
        }
        Some(stored_seq) => {
            if incoming_seq > stored_seq {
                // Case 1: Incoming newer (incoming_seq > stored_seq)
                if !can_transition_str(&stored_status_norm, &incoming_status_norm) {
                    return EvaluationOutcome::RejectInvalidTransition {
                        from: stored.status.clone(),
                        to: incoming.status.clone(),
                    };
                }
                EvaluationOutcome::Write {
                    new_status: incoming.status.clone(),
                    new_balance: incoming.balance.clone(),
                    new_ledger_seq: Some(incoming_seq),
                }
            } else if incoming_seq < stored_seq {
                // Case 2: Incoming older (incoming_seq < stored_seq)
                // Reject silently, no write, no error.
                EvaluationOutcome::RejectStale
            } else {
                // Equal sequence (incoming_seq == stored_seq)
                let status_matches = stored_status_norm == incoming_status_norm;
                let balance_matches = balances_equal(&stored.balance, &incoming.balance);

                if status_matches && balance_matches {
                    // Case 3: Equal seq, same values -> idempotent, no write, no error.
                    EvaluationOutcome::IdempotentUnchanged
                } else {
                    // Case 4: Equal seq, different values -> preserve stored confirmed state,
                    // produce conflict log entry.
                    EvaluationOutcome::ConflictLogEntry {
                        reason: format!(
                            "Conflict on seq {}: stored(status={}, balance={}) vs incoming(status={}, balance={})",
                            incoming_seq, stored.status, stored.balance, incoming.status, incoming.balance
                        ),
                    }
                }
            }
        }
    }
}

pub fn parse_updates(updates_json: &str) -> Result<Vec<EscrowUpdate>, String> {
    serde_json::from_str(updates_json).map_err(|e| format!("invalid updates JSON: {e}"))
}

pub fn dedupe_last_wins(updates: Vec<EscrowUpdate>) -> Vec<EscrowUpdate> {
    use std::collections::HashMap;
    let mut position: HashMap<String, usize> = HashMap::with_capacity(updates.len());
    let mut result: Vec<EscrowUpdate> = Vec::with_capacity(updates.len());
    for u in updates {
        match position.get(&u.contract_id) {
            Some(&i) => result[i] = u,
            None => {
                position.insert(u.contract_id.clone(), result.len());
                result.push(u);
            }
        }
    }
    result
}

// ─── Database Execution with Tokio-Postgres ───────────────────────────────────

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        Runtime::new().expect("failed to initialise Tokio runtime for pg-bulk-upsert")
    })
}

fn connection_cell() -> &'static Mutex<Option<(String, Client)>> {
    static CELL: OnceLock<Mutex<Option<(String, Client)>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

async fn run_bulk_upsert(
    updates: &[EscrowUpdate],
    conn_string: &str,
) -> Result<(u64, u64), String> {
    let mut guard = connection_cell().lock().await;

    let needs_connect = match guard.as_ref() {
        Some((cached, client)) => cached != conn_string || client.is_closed(),
        None => true,
    };
    if needs_connect {
        let (client, connection) = tokio_postgres::connect(conn_string, NoTls)
            .await
            .map_err(|e| format!("DB connect failed: {e}"))?;
        runtime().spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("[pg-bulk-upsert] connection error: {e}");
            }
        });
        *guard = Some((conn_string.to_string(), client));
    }

    let client = &mut guard.as_mut().expect("client set above").1;
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Transaction begin failed: {e}"))?;

    let mut rows_affected: u64 = 0;
    let mut unchanged: u64 = 0;

    for u in updates {
        let key = if let Some(ref id) = u.id {
            if !id.is_empty() {
                id.as_str()
            } else {
                u.contract_id.as_str()
            }
        } else {
            u.contract_id.as_str()
        };

        // Atomic row lock via SELECT ... FOR UPDATE
        let row_opt = tx
            .query_opt(SELECT_LOCK_SQL, &[&key])
            .await
            .map_err(|e| format!("SELECT FOR UPDATE failed: {e}"))?;

        let stored = row_opt.as_ref().map(|row| {
            let seq: Option<i64> = row.get(0);
            let status: String = row.get(1);
            let balance: String = row.get(2);
            let network: Option<String> = row.get(3);
            StoredEscrowRow {
                id: key.to_string(),
                contract_id: u.contract_id.clone(),
                status,
                balance,
                ledger_seq: seq,
                network,
            }
        });

        match evaluate_observation(stored.as_ref(), u) {
            EvaluationOutcome::Write {
                new_status,
                new_balance,
                new_ledger_seq,
            } => {
                if stored.is_some() {
                    let rows = tx
                        .execute(
                            UPDATE_ROW_SQL,
                            &[&key, &new_status, &new_balance, &new_ledger_seq],
                        )
                        .await
                        .map_err(|e| format!("UPDATE failed: {e}"))?;
                    rows_affected += rows;
                } else {
                    let rows = tx
                        .execute(
                            INSERT_ROW_SQL,
                            &[
                                &u.contract_id,
                                &new_status,
                                &u.amount,
                                &new_balance,
                                &new_ledger_seq,
                            ],
                        )
                        .await
                        .map_err(|e| format!("INSERT failed: {e}"))?;
                    rows_affected += rows;
                }
            }
            EvaluationOutcome::RejectStale | EvaluationOutcome::IdempotentUnchanged => {
                unchanged += 1;
            }
            EvaluationOutcome::ConflictLogEntry { reason } => {
                eprintln!("[pg-bulk-upsert] CONFLICT: {}", reason);
                unchanged += 1;
            }
            EvaluationOutcome::RejectTerminal { stored_status } => {
                eprintln!(
                    "[pg-bulk-upsert] Terminal state overwrite rejected for escrow {}: stored is {}",
                    key, stored_status
                );
                unchanged += 1;
            }
            EvaluationOutcome::RejectUnversionedForConfirmed { stored_status } => {
                eprintln!(
                    "[pg-bulk-upsert] Unversioned snapshot rejected for confirmed escrow {}: stored is {}",
                    key, stored_status
                );
                unchanged += 1;
            }
            EvaluationOutcome::RejectInvalidTransition { from, to } => {
                eprintln!(
                    "[pg-bulk-upsert] Invalid state transition rejected for escrow {}: {} -> {}",
                    key, from, to
                );
                unchanged += 1;
            }
            EvaluationOutcome::RejectNetworkMismatch { stored, incoming } => {
                eprintln!(
                    "[pg-bulk-upsert] Network mismatch rejected for escrow {}: stored={}, incoming={}",
                    key, stored, incoming
                );
                unchanged += 1;
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Transaction commit failed: {e}"))?;

    Ok((rows_affected, unchanged))
}

// ─── Neon Export ─────────────────────────────────────────────────────────────

fn bulk_upsert_escrows(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let updates_json = cx.argument::<JsString>(0)?.value(&mut cx);
    let conn_string = cx.argument::<JsString>(1)?.value(&mut cx);

    let (deferred, promise) = cx.promise();
    let channel = cx.channel();

    let updates = match parse_updates(&updates_json) {
        Ok(u) => dedupe_last_wins(u),
        Err(e) => {
            let error = cx.error(e)?;
            deferred.reject(&mut cx, error);
            return Ok(promise);
        }
    };

    if updates.is_empty() {
        let result = BulkUpsertResult {
            rows_affected: 0,
            unchanged: 0,
            duration_ms: 0,
        };
        let json = serde_json::to_string(&result).expect("serialises");
        deferred.settle_with(&channel, move |mut cx| Ok(cx.string(json)));
        return Ok(promise);
    }

    runtime().spawn(async move {
        let started = Instant::now();
        let outcome = run_bulk_upsert(&updates, &conn_string).await;
        let duration_ms = started.elapsed().as_millis() as u64;

        deferred.settle_with(&channel, move |mut cx| match outcome {
            Ok((rows_affected, unchanged)) => {
                let result = BulkUpsertResult {
                    rows_affected,
                    unchanged,
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

// ─── Comprehensive Unit & Ordering Tests (`cargo test`) ──────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, status: &str, balance: &str, seq: Option<i64>) -> EscrowUpdate {
        EscrowUpdate {
            id: Some(id.to_string()),
            contract_id: id.to_string(),
            status: status.to_string(),
            amount: "100.0000000".to_string(),
            balance: balance.to_string(),
            marker: "M".to_string(),
            approver: "A".to_string(),
            releaser: "R".to_string(),
            escrow_type: "single_release".to_string(),
            ledger_seq: seq,
            network: Some("testnet".to_string()),
        }
    }

    fn stored_row(id: &str, status: &str, balance: &str, seq: Option<i64>) -> StoredEscrowRow {
        StoredEscrowRow {
            id: id.to_string(),
            contract_id: id.to_string(),
            status: status.to_string(),
            balance: balance.to_string(),
            ledger_seq: seq,
            network: Some("testnet".to_string()),
        }
    }

    #[test]
    fn parses_full_escrow_rows_with_optional_seq() {
        let json = r#"[
            {"contract_id":"C1","status":"funded","amount":"100.0000000",
             "balance":"50.0000000","marker":"M","approver":"A","releaser":"R",
             "escrow_type":"single_release","ledger_seq":12345}
        ]"#;
        let updates = parse_updates(json).unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].contract_id, "C1");
        assert_eq!(updates[0].ledger_seq, Some(12345));
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_updates("{not json").is_err());
    }

    #[test]
    fn out_of_order_stale_snapshot_rejected() {
        // Delayed funded/nonzero snapshot arrives after a completed/zero state
        let stored = stored_row("C1", "completed", "0.0000000", Some(200));
        let incoming = sample("C1", "funded", "100.0000000", Some(100));

        let outcome = evaluate_observation(Some(&stored), &incoming);
        // Both terminal state protection and stale ordering reject it
        assert!(matches!(
            outcome,
            EvaluationOutcome::RejectTerminal { .. } | EvaluationOutcome::RejectStale
        ));
    }

    #[test]
    fn valid_later_transition_write_succeeds() {
        // Newer sequence with valid state machine transition (funded -> active)
        let stored = stored_row("C1", "funded", "100.0000000", Some(100));
        let incoming = sample("C1", "active", "100.0000000", Some(150));

        let outcome = evaluate_observation(Some(&stored), &incoming);
        assert_eq!(
            outcome,
            EvaluationOutcome::Write {
                new_status: "active".to_string(),
                new_balance: "100.0000000".to_string(),
                new_ledger_seq: Some(150),
            }
        );
    }

    #[test]
    fn duplicate_observations_same_seq_same_values_idempotent() {
        let stored = stored_row("C1", "funded", "100.0000000", Some(100));
        let incoming = sample("C1", "funded", "100.0000000", Some(100));

        let outcome = evaluate_observation(Some(&stored), &incoming);
        assert_eq!(outcome, EvaluationOutcome::IdempotentUnchanged);
    }

    #[test]
    fn duplicate_observations_with_different_decimal_padding_idempotent() {
        // "100" vs "100.0000000" are numerically identical — no rounding, exact check
        let stored = stored_row("C1", "funded", "100.0000000", Some(100));
        let incoming = sample("C1", "funded", "100", Some(100));

        let outcome = evaluate_observation(Some(&stored), &incoming);
        assert_eq!(outcome, EvaluationOutcome::IdempotentUnchanged);
    }

    #[test]
    fn equal_seq_different_values_conflict_logged() {
        // Equal seq, differing values preserves stored confirmed state and logs conflict
        let stored = stored_row("C1", "funded", "100.0000000", Some(100));
        let incoming = sample("C1", "cancelled", "0.0000000", Some(100));

        let outcome = evaluate_observation(Some(&stored), &incoming);
        assert!(matches!(
            outcome,
            EvaluationOutcome::ConflictLogEntry { .. }
        ));
    }

    #[test]
    fn terminal_state_completed_cannot_be_overwritten_by_any_observation() {
        let stored = stored_row("C1", "completed", "0.0000000", Some(100));

        // Even with a higher sequence number, completed cannot be overwritten
        let incoming_newer = sample("C1", "funded", "100.0000000", Some(300));
        assert!(matches!(
            evaluate_observation(Some(&stored), &incoming_newer),
            EvaluationOutcome::RejectTerminal { .. }
        ));

        // Cancelled is not reachable from completed regardless of sequence
        let incoming_cancelled = sample("C1", "cancelled", "0.0000000", Some(300));
        assert!(matches!(
            evaluate_observation(Some(&stored), &incoming_cancelled),
            EvaluationOutcome::RejectTerminal { .. }
        ));
    }

    #[test]
    fn terminal_state_resolved_cannot_be_overwritten() {
        let stored = stored_row("C1", "resolved", "0.0000000", Some(100));
        let incoming = sample("C1", "disputed", "100.0000000", Some(200));

        assert!(matches!(
            evaluate_observation(Some(&stored), &incoming),
            EvaluationOutcome::RejectTerminal { .. }
        ));
    }

    #[test]
    fn network_identity_testnet_rejected_for_mainnet() {
        let mut stored = stored_row("C1", "funded", "100.0000000", Some(100));
        stored.network = Some("mainnet".to_string());

        let mut incoming = sample("C1", "milestone_approved", "100.0000000", Some(200));
        incoming.network = Some("testnet".to_string());

        let outcome = evaluate_observation(Some(&stored), &incoming);
        assert!(matches!(
            outcome,
            EvaluationOutcome::RejectNetworkMismatch { .. }
        ));
    }

    #[test]
    fn unversioned_snapshot_rejected_for_confirmed_records() {
        let stored_completed = stored_row("C1", "completed", "0.0000000", Some(100));
        let incoming = sample("C1", "funded", "100.0000000", None);

        assert!(matches!(
            evaluate_observation(Some(&stored_completed), &incoming),
            EvaluationOutcome::RejectTerminal { .. }
                | EvaluationOutcome::RejectUnversionedForConfirmed { .. }
        ));

        let stored_funded = stored_row("C1", "funded", "100.0000000", Some(100));
        assert!(matches!(
            evaluate_observation(Some(&stored_funded), &incoming),
            EvaluationOutcome::RejectUnversionedForConfirmed { .. }
        ));
    }

    #[test]
    fn unversioned_snapshot_writes_to_pending_without_zeroing_nonzero_balance() {
        // Pending record with nonzero balance: unversioned snapshot must NOT zero it
        let stored = stored_row("C1", "created", "75.5000000", None);
        let incoming = sample("C1", "funded", "0.0000000", None);

        let outcome = evaluate_observation(Some(&stored), &incoming);
        assert_eq!(
            outcome,
            EvaluationOutcome::Write {
                new_status: "funded".to_string(),
                new_balance: "75.5000000".to_string(), // Stored nonzero balance preserved!
                new_ledger_seq: None,
            }
        );
    }

    #[test]
    fn invalid_state_machine_transition_rejected_regardless_of_sequence() {
        // Jumping directly from created -> completed is invalid
        let stored = stored_row("C1", "created", "100.0000000", Some(50));
        let incoming = sample("C1", "completed", "0.0000000", Some(200));

        let outcome = evaluate_observation(Some(&stored), &incoming);
        assert!(matches!(
            outcome,
            EvaluationOutcome::RejectInvalidTransition { .. }
        ));
    }

    #[test]
    fn exact_token_amounts_preserved_losslessly() {
        let exact_amount = "1234567.8901234";
        let stored = stored_row("C1", "funded", exact_amount, Some(100));
        let incoming = sample("C1", "milestone_approved", exact_amount, Some(150));

        let outcome = evaluate_observation(Some(&stored), &incoming);
        if let EvaluationOutcome::Write { new_balance, .. } = outcome {
            assert_eq!(new_balance, exact_amount);
        } else {
            panic!("Expected Write outcome, got {:?}", outcome);
        }
    }

    #[test]
    fn dedupe_last_wins_keeps_last_occurrence() {
        let mut a = sample("C1", "funded", "1.0000000", Some(10));
        let b = sample("C2", "funded", "2.0000000", Some(20));
        let mut a2 = sample("C1", "active", "9.0000000", Some(30));

        a.balance = "1.0000000".to_string();
        a2.balance = "9.0000000".to_string();

        let deduped = dedupe_last_wins(vec![a, b, a2]);
        assert_eq!(deduped.len(), 2);
        assert_eq!(deduped[0].contract_id, "C1");
        assert_eq!(deduped[0].balance, "9.0000000");
        assert_eq!(deduped[0].ledger_seq, Some(30));
    }

    #[test]
    fn concurrent_writers_resolution_simulation() {
        // Simulation of two concurrent writers reading stored state at seq 100:
        // Stored starts at seq 100
        let stored = stored_row("C1", "funded", "100.0000000", Some(100));

        // Writer 1 attempts to write seq 110 (milestone_approved)
        let w1 = sample("C1", "milestone_approved", "100.0000000", Some(110));
        let outcome_w1 = evaluate_observation(Some(&stored), &w1);
        assert!(matches!(outcome_w1, EvaluationOutcome::Write { .. }));

        // Suppose Writer 1 commits and updates the stored record to seq 110
        let updated_stored = stored_row("C1", "milestone_approved", "100.0000000", Some(110));

        // Writer 2 (who had read seq 100 concurrently) attempts to write seq 105 (stale funded update)
        let w2 = sample("C1", "funded", "100.0000000", Some(105));
        let outcome_w2 = evaluate_observation(Some(&updated_stored), &w2);

        // Under row locking (FOR UPDATE), Writer 2 evaluates against updated stored state and is rejected
        assert_eq!(outcome_w2, EvaluationOutcome::RejectStale);
    }
}
